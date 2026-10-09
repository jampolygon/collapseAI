"""Optional LAN service. Missing resources degrade health, never prevent startup."""
import asyncio
import json
import re
from contextlib import asynccontextmanager
from urllib.parse import unquote, urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from . import __version__
from .config import Settings
from .file_server import resource_path, serve_file
from .llama_proxy import chat_proxy, llama_health
from .maps import MapDiscovery, sha256_file


def read_manifest(settings):
    try:
        value = json.loads(settings.manifest.read_text(encoding="utf-8-sig"))
        if not isinstance(value, dict) or value.get("schema_version") != 1:
            raise ValueError("Unsupported resource manifest schema")
        for key in ("packs", "models"):
            if not isinstance(value.get(key), list):
                raise ValueError(f"Manifest {key} must be an array")
            ids = set()
            for entry in value[key]:
                if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not entry["id"] or entry["id"] in ids:
                    raise ValueError(f"Manifest {key} has invalid or duplicate IDs")
                ids.add(entry["id"])
                if key == "packs":
                    path = entry.get("path", "")
                    if not isinstance(path, str) or not path.startswith("/packs/") or path.count("/") != 2:
                        raise ValueError("Manifest has an invalid pack path")
                    if type(entry.get("size")) is not int or entry["size"] <= 0 or not isinstance(entry.get("sha256"), str) or not re.fullmatch(r"[a-fA-F0-9]{64}", entry["sha256"]):
                        raise ValueError("Manifest has invalid pack size/hash")
                elif "url" in entry:
                    if not isinstance(entry["url"], str):
                        raise ValueError("Manifest has an invalid model URL")
                    url = urlsplit(entry["url"])
                    if url.scheme not in ("http", "https") or not url.hostname:
                        raise ValueError("Manifest has an invalid model URL")
        return value, {"status": "ok", "available": True}
    except (OSError, ValueError) as exc:
        return {"packs": [], "models": []}, {"status": "unavailable", "available": False,
                                             "error": "Resource manifest missing or unreadable" if isinstance(exc, OSError) else str(exc)}


def resources(settings):
    manifest, health = read_manifest(settings)
    packs = []
    for entry in manifest["packs"]:
        pack = {**entry, "filename": entry["path"].split("/")[-1], "available": False}
        try:
            path = resource_path(settings.pack_dir, pack["filename"], ".json")
            pack["available"] = path.stat().st_size == entry["size"] and sha256_file(path) == entry["sha256"].lower()
            if not pack["available"]:
                pack["error"] = "File does not match resource manifest; rebuild packs and manifest"
        except (HTTPException, OSError):
            pack["error"] = "Not installed or unreadable"
        packs.append(pack)
    models, used = [], set()
    for entry in manifest["models"]:
        url = entry.get("url")
        filename = unquote(urlsplit(url).path.split("/")[-1]) if isinstance(url, str) else ""
        model = {**entry, "url": f"/models/{filename}" if filename else None,
                 "source_url": url, "filename": filename or None, "available": False, "size": None, "sha256": None}
        try:
            path = resource_path(settings.model_dir, filename, ".gguf")
            with path.open("rb") as file:
                readable = bool(file.read(1))
            model.update(available=readable, size=path.stat().st_size)
            used.add(filename)
        except (HTTPException, OSError):
            pass
        models.append(model)
    try:
        for path in sorted(settings.model_dir.glob("*.gguf")):
            if path.name in used:
                continue
            try:
                safe = resource_path(settings.model_dir, path.name, ".gguf")
                with safe.open("rb") as file:
                    readable = bool(file.read(1))
                models.append({"id": f"local:{path.stem}", "filename": path.name, "url": f"/models/{path.name}",
                               "size": safe.stat().st_size, "sha256": None, "available": readable})
            except (HTTPException, OSError):
                continue
    except (HTTPException, OSError):
        pass
    return packs, models, health


def directory_health(path, count):
    try:
        available = path.is_dir()
        if available:
            # Check actual enumeration permission rather than just the stat.
            next(path.iterdir(), None)
        return {"status": "ok" if available and count else "unavailable", "available": available, "files": count}
    except OSError:
        return {"status": "unavailable", "available": False, "files": 0}


def create_app(settings=None, transport=None):
    settings = settings or Settings.from_env()
    discovery = MapDiscovery(settings.map_dir)

    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(transport=transport, trust_env=False, follow_redirects=False,
                                    timeout=httpx.Timeout(300, connect=3, pool=3),
                                    limits=httpx.Limits(max_connections=16, max_keepalive_connections=4)) as client:
            app.state.http_client = client
            yield

    app = FastAPI(title=settings.name, version=__version__, lifespan=lifespan)
    app.state.settings = settings
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                           allow_methods=["GET", "HEAD", "POST"], allow_headers=["Content-Type", "Range", "If-Range"],
                           expose_headers=["Content-Length", "Content-Range", "Accept-Ranges", "ETag"])

    @app.get("/api/info")
    async def info():
        (packs, models, manifest), maps, ai = await asyncio.gather(
            run_in_threadpool(resources, settings), run_in_threadpool(discovery.discover),
            llama_health(app.state.http_client, settings.llama_url))
        return {"name": settings.name, "version": __version__, "packs": packs, "models": models,
                "maps": maps, "ai": ai, "resource_manifest": manifest}

    @app.get("/health")
    async def health():
        data = await info()
        parts = {"hub": {"status": "ok", "available": True}, "resource_manifest": data["resource_manifest"],
                 "pack_directory": directory_health(settings.pack_dir, sum(p["available"] for p in data["packs"])),
                 "model_directory": directory_health(settings.model_dir, sum(m["available"] for m in data["models"])),
                 "map_directory": directory_health(settings.map_dir, sum(m["available"] for m in data["maps"])),
                 "llama_server": data["ai"]}
        return {"status": "ok" if all(part["status"] == "ok" for part in parts.values()) else "degraded", **parts}

    def register_files(route, root, suffix):
        def endpoint(request: Request, filename: str):
            return serve_file(request, root, filename, suffix)
        app.add_api_route(route, endpoint, methods=["GET", "HEAD"], name=route)

    register_files("/packs/{filename}", settings.pack_dir, ".json")
    register_files("/models/{filename}", settings.model_dir, ".gguf")
    register_files("/maps/{filename}", settings.map_dir, ".pmtiles")
    # Compatibility with the existing PWA same-origin map asset contract.

    @app.get("/offline-maps/regions.json")
    def map_catalog():
        # Generate the existing frontend schema from files, without fabricated values.
        from datetime import datetime, timezone
        regions = []
        for item in discovery.discover(hashes=True):
            if not item["available"] or item["size"] > 128 * 1024 * 1024:
                continue
            updated = datetime.fromtimestamp((settings.map_dir / item["filename"]).stat().st_mtime, timezone.utc).isoformat()
            regions.append({"id": item["id"], "name": item["name"], "province": item["name"],
                            "pmtilesUrl": f"./maps/{item['filename']}", "sizeBytes": item["size"], "sha256": item["sha256"],
                            "bounds": item["bounds"], "center": item["center"], "revision": item["sha256"][:16],
                            "updatedAt": updated, "tileSchema": "protomaps-basemaps"})
        return {"version": 1, "updatedAt": max((r["updatedAt"] for r in regions), default="1970-01-01T00:00:00Z"),
                "attribution": "© OpenStreetMap contributors", "regions": regions}

    register_files("/offline-maps/{filename}", settings.map_dir, ".pmtiles")
    app.add_api_route("/v1/chat/completions", chat_proxy, methods=["POST"])
    return app


app = create_app()
