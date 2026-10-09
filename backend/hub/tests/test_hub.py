"""Synthetic files and mocked upstreams, never GGUF inference or real map rendering."""
import asyncio
import hashlib
import json
import os
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.hub.app import create_app
from backend.hub.config import Settings
from backend.hub.maps import inspect_archive
from backend.hub.tests.fixtures import synthetic_archive


def unavailable(request):
    raise httpx.ConnectError("Synthetic upstream unavailable", request=request)


class HubTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.settings = Settings(pack_dir=root / "packs", model_dir=root / "models", map_dir=root / "maps", manifest=root / "manifest.json")
        for directory in (self.settings.pack_dir, self.settings.model_dir, self.settings.map_dir):
            directory.mkdir()
        self.pack = b'{"id":"fixture","articles":[]}'
        self.model = b"Synthetic model download fixture; this is not a GGUF."
        self.map = synthetic_archive()
        (self.settings.pack_dir / "fixture.json").write_bytes(self.pack)
        (self.settings.model_dir / "fixture.gguf").write_bytes(self.model)
        (self.settings.map_dir / "luzon.pmtiles").write_bytes(self.map)
        self.manifest = {"schema_version": 1, "packs": [{"id": "fixture", "path": "/packs/fixture.json",
                          "size": len(self.pack), "sha256": hashlib.sha256(self.pack).hexdigest(), "articles": 0}],
                         "models": [{"id": "fixture-model", "url": "https://example.invalid/fixture.gguf", "size": None, "sha256": None}]}
        self.settings.manifest.write_text(json.dumps(self.manifest), encoding="utf-8")
        self.client = self.enterContext(TestClient(create_app(self.settings, httpx.MockTransport(unavailable))))

    def files(self):
        return (("/packs/fixture.json", self.pack), ("/models/fixture.gguf", self.model), ("/maps/luzon.pmtiles", self.map))

    def test_health_degraded_but_operational(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "degraded")
        self.assertTrue(data["hub"]["available"])
        self.assertFalse(data["llama_server"]["available"])
        self.assertTrue(data["resource_manifest"]["available"])
        for key in ("pack_directory", "model_directory", "map_directory"):
            self.assertTrue(data[key]["available"])

    def test_info_uses_manifest_and_discovers_files(self):
        data = self.client.get("/api/info").json()
        self.assertEqual(data["packs"][0]["sha256"], self.manifest["packs"][0]["sha256"])
        self.assertTrue(data["packs"][0]["available"])
        self.assertTrue(data["models"][0]["available"])
        self.assertEqual(data["models"][0]["size"], len(self.model))
        self.assertIsNone(data["models"][0]["sha256"])
        self.assertEqual([item["id"] for item in data["maps"]], ["luzon", "visayas", "mindanao"])
        self.assertTrue(data["maps"][0]["available"])
        self.assertIsNone(data["maps"][0]["sha256"])
        self.assertFalse(data["maps"][1]["available"])
        self.assertIsNone(data["maps"][1]["size"])

    def test_map_catalog_matches_frontend_contract(self):
        response = self.client.get("/offline-maps/regions.json")
        self.assertEqual(response.status_code, 200)
        item = response.json()["regions"][0]
        self.assertEqual(item["pmtilesUrl"], "./maps/luzon.pmtiles")
        self.assertEqual(item["sha256"], hashlib.sha256(self.map).hexdigest())
        self.assertEqual(item["sizeBytes"], len(self.map))
        self.assertEqual(self.client.get("/offline-maps/luzon.pmtiles").content, self.map)

    def test_no_resource_directories_or_manifest(self):
        settings = replace(self.settings, manifest=self.settings.manifest.parent / "absent.json",
                           model_dir=self.settings.model_dir / "absent", map_dir=self.settings.map_dir / "absent")
        with TestClient(create_app(settings, httpx.MockTransport(unavailable))) as client:
            self.assertEqual(client.get("/health").status_code, 200)
            data = client.get("/api/info").json()
            self.assertEqual(data["packs"], [])
            self.assertFalse(any(item["available"] for item in data["maps"]))
            self.assertEqual(client.get("/offline-maps/regions.json").json()["regions"], [])

    def test_empty_directories_report_unavailable(self):
        for path in self.settings.model_dir.iterdir():
            path.unlink()
        self.assertEqual(self.client.get("/health").json()["model_directory"]["status"], "unavailable")

    def test_malformed_manifest_degrades(self):
        for value in ("{broken", "null", '{"schema_version":2}', '{"schema_version":1,"packs":{},"models":[]}'):
            with self.subTest(value=value):
                self.settings.manifest.write_text(value)
                self.assertFalse(self.client.get("/health").json()["resource_manifest"]["available"])

    def test_changed_pack_is_not_available(self):
        (self.settings.pack_dir / "fixture.json").write_bytes(b"different")
        self.assertFalse(self.client.get("/api/info").json()["packs"][0]["available"])

    def test_corrupt_map_and_replacement(self):
        path = self.settings.map_dir / "luzon.pmtiles"
        self.client.get("/api/info")  # Warm validation cache.
        path.write_bytes(b"not a map")
        data = self.client.get("/api/info").json()["maps"][0]
        self.assertFalse(data["available"])
        self.assertIn("PMTiles", data["error"])
        path.write_bytes(self.map)
        self.assertTrue(self.client.get("/api/info").json()["maps"][0]["available"])

    def test_full_download_all_resources(self):
        for url, content in self.files():
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, content)
                self.assertEqual(response.headers["accept-ranges"], "bytes")
                self.assertEqual(int(response.headers["content-length"]), len(content))

    def test_ranges_all_resources(self):
        for url, content in self.files():
            for value, start, end in (("bytes=2-5", 2, 5), ("bytes=3-", 3, len(content) - 1),
                                      ("bytes=-4", len(content) - 4, len(content) - 1), ("bytes=0-999999", 0, len(content) - 1)):
                with self.subTest(url=url, value=value):
                    response = self.client.get(url, headers={"Range": value})
                    self.assertEqual(response.status_code, 206)
                    self.assertEqual(response.content, content[start:end + 1])
                    self.assertEqual(response.headers["content-range"], f"bytes {start}-{end}/{len(content)}")
                    self.assertEqual(int(response.headers["content-length"]), end - start + 1)

    def test_invalid_ranges_all_resources(self):
        for url, content in self.files():
            for value in ("", "bytes=99999-", "bytes=5-2", "bytes=-0", "bytes=-", "garbage", "items=0-1", "bytes=0-1,3-4"):
                with self.subTest(url=url, value=value):
                    response = self.client.get(url, headers={"Range": value})
                    self.assertEqual(response.status_code, 416)
                    self.assertEqual(response.headers["content-range"], f"bytes */{len(content)}")

    def test_head_full_and_range(self):
        for url, content in self.files():
            for headers, expected in (({}, 200), ({"Range": "bytes=2-5"}, 206)):
                response = self.client.head(url, headers=headers)
                self.assertEqual(response.status_code, expected)
                self.assertEqual(response.content, b"")
                self.assertEqual(int(response.headers["content-length"]), len(content) if expected == 200 else 4)

    def test_if_range_changed_returns_full(self):
        response = self.client.get("/maps/luzon.pmtiles", headers={"Range": "bytes=1-2", "If-Range": '"old"'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, self.map)

    def test_empty_file_and_range(self):
        (self.settings.model_dir / "empty.gguf").write_bytes(b"")
        self.assertEqual(self.client.get("/models/empty.gguf").content, b"")
        self.assertEqual(self.client.get("/models/empty.gguf", headers={"Range": "bytes=0-0"}).status_code, 416)

    def test_missing_resources(self):
        for url in ("/packs/absent.json", "/models/absent.gguf", "/maps/absent.pmtiles"):
            self.assertEqual(self.client.get(url).status_code, 404)

    def test_security_traversal_and_wrong_extensions(self):
        for url in ("/packs/%2e%2e%2fmanifest.json", "/packs/%2e%2e%5cmanifest.json", "/maps/%2e%2e.pmtiles",
                    "/maps/C%3Asecret.pmtiles", "/models/fixture.gguf%00", "/models/manifest.json", "/packs/a%252fb.json"):
            with self.subTest(url=url):
                self.assertIn(self.client.get(url).status_code, (400, 404))

    def test_security_symlink_outside_root(self):
        target = self.settings.manifest.parent / "outside.gguf"
        target.write_bytes(b"secret")
        try:
            (self.settings.model_dir / "link.gguf").symlink_to(target)
        except OSError:
            self.skipTest("OS does not permit symlink creation")
        self.assertEqual(self.client.get("/models/link.gguf").status_code, 404)

    def test_ai_unavailable_503(self):
        response = self.client.post("/v1/chat/completions", json={"messages": [{"role": "user", "content": "test"}]})
        self.assertEqual(response.status_code, 503)
        self.assertIn("llama-server", response.json()["detail"])

    def test_ai_request_validation(self):
        for value in ([], {}, {"messages": []}, {"messages": [1], "stream": "yes"}):
            self.assertEqual(self.client.post("/v1/chat/completions", json=value).status_code, 400)

    def test_ai_nonstream_and_health(self):
        payload = {"messages": [{"role": "user", "content": "synthetic request"}], "stream": False}
        def upstream(request):
            if request.url.path == "/health":
                return httpx.Response(200, json={"status": "ok"})
            self.assertEqual(json.loads(request.content), payload)
            self.assertEqual(request.url.host, "127.0.0.1")
            return httpx.Response(200, json={"choices": [{"message": {"content": "mock answer"}}]})
        with TestClient(create_app(self.settings, httpx.MockTransport(upstream))) as client:
            self.assertTrue(client.get("/api/info").json()["ai"]["available"])
            self.assertEqual(client.post("/v1/chat/completions", json=payload).json()["choices"][0]["message"]["content"], "mock answer")

    def test_ai_upstream_status_and_redirect(self):
        for code, expected in ((400, 400), (500, 503), (503, 503), (307, 307)):
            with TestClient(create_app(self.settings, httpx.MockTransport(lambda r: httpx.Response(code, json={"error": "mock"})))) as client:
                self.assertEqual(client.post("/v1/chat/completions", json={"messages": [1]}).status_code, expected)

    def test_stream_read_failure_closes_and_reports_sse_error(self):
        closed = []
        class BrokenStream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b'data: {"fixture":true}\n\n'
                raise httpx.ReadError("Synthetic dropped stream")
            async def aclose(self):
                closed.append(True)
        with TestClient(create_app(self.settings, httpx.MockTransport(lambda r: httpx.Response(200, stream=BrokenStream(), headers={"Content-Type": "text/event-stream"})))) as client:
            response = client.post("/v1/chat/completions", json={"messages": [1], "stream": True})
            self.assertEqual(response.status_code, 200)
            self.assertIn("upstream_unavailable", response.text)
            self.assertTrue(closed)

    def test_stream_wrong_media_type_is_rejected(self):
        with TestClient(create_app(self.settings, httpx.MockTransport(lambda r: httpx.Response(200, json={"fixture": True})))) as client:
            self.assertEqual(client.post("/v1/chat/completions", json={"messages": [1], "stream": True}).status_code, 502)

    def test_cors_is_explicit(self):
        settings = replace(self.settings, cors_origins=("http://localhost:5173",))
        with TestClient(create_app(settings, httpx.MockTransport(unavailable))) as client:
            response = client.get("/maps/luzon.pmtiles", headers={"Origin": "http://localhost:5173", "Range": "bytes=0-1"})
            self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:5173")
            self.assertIn("Content-Range", response.headers["access-control-expose-headers"])
            self.assertNotIn("access-control-allow-origin", client.get("/api/info", headers={"Origin": "https://unknown.invalid"}).headers)

    def test_environment_paths_and_launch_options(self):
        with patch.dict(os.environ, {"COLLAPSEAI_MODEL_DIR": str(self.settings.model_dir), "COLLAPSEAI_MAP_DIR": str(self.settings.map_dir),
                                     "COLLAPSEAI_HOST": "127.0.0.1", "COLLAPSEAI_PORT": "9876", "COLLAPSEAI_LLAMA_URL": "http://127.0.0.1:1234/"}):
            config = Settings.from_env()
            self.assertEqual(config.port, 9876)
            self.assertEqual(config.model_dir, self.settings.model_dir.resolve())
            self.assertEqual(config.llama_url, "http://127.0.0.1:1234")

    def test_invalid_map_sections_and_metadata(self):
        for corruption in (b"broken", self.map[:130], self.map[:97] + b"\x04" + self.map[98:]):
            path = self.settings.map_dir / "broken.pmtiles"
            path.write_bytes(corruption)
            with self.assertRaises(ValueError):
                inspect_archive(path)


class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_sse_is_incremental_and_closes_upstream(self):
        gate = asyncio.Event()
        first_delivered = asyncio.Event()
        closed = []
        class UpstreamStream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b'data: {"choices":[{"delta":{"content":"mock"}}]}\n\n'
                await gate.wait()
                yield b'data: [DONE]\n\n'
            async def aclose(self):
                closed.append(True)
        app = create_app(transport=httpx.MockTransport(lambda r: httpx.Response(200, stream=UpstreamStream(), headers={"Content-Type": "text/event-stream"})))
        body = json.dumps({"messages": [{"role": "user", "content": "test"}], "stream": True}).encode()
        sent = []
        received = False
        async def receive():
            nonlocal received
            if not received:
                received = True
                return {"type": "http.request", "body": body, "more_body": False}
            await asyncio.Event().wait()
        async def send(message):
            sent.append(message)
            if message["type"] == "http.response.body" and b'"mock"' in message.get("body", b""):
                first_delivered.set()
        scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"}, "http_version": "1.1", "method": "POST",
                 "scheme": "http", "path": "/v1/chat/completions", "raw_path": b"/v1/chat/completions", "query_string": b"",
                 "root_path": "", "headers": [(b"content-type", b"application/json")], "client": ("127.0.0.1", 1), "server": ("hub", 80)}
        async with app.router.lifespan_context(app):
            task = asyncio.create_task(app(scope, receive, send))
            try:
                await asyncio.wait_for(first_delivered.wait(), 3)
                self.assertFalse(task.done(), "Answer was buffered until completion")
                gate.set()
                await asyncio.wait_for(task, 3)
            finally:
                task.cancel()
        self.assertTrue(closed)
        self.assertEqual(sent[0]["status"], 200)
        self.assertIn(b"[DONE]", b"".join(item.get("body", b"") for item in sent))


if __name__ == "__main__":
    unittest.main()
