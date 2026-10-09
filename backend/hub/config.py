"""Configuration is independent of the working directory; no directories are created."""
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    name: str = "CollapseAI Hub"
    host: str = "0.0.0.0"
    port: int = 8000
    pack_dir: Path = ROOT / "frontend/public/packs"
    manifest: Path = ROOT / "frontend/public/manifest.json"
    model_dir: Path = ROOT / "backend/data/models"
    map_dir: Path = ROOT / "backend/data/maps"
    llama_url: str = "http://127.0.0.1:8080"
    cors_origins: tuple[str, ...] = ()

    @classmethod
    def from_env(cls):
        def path(key, default):
            return Path(os.environ.get(key, str(default))).expanduser().resolve()

        defaults = cls()
        url = os.environ.get("COLLAPSEAI_LLAMA_URL", defaults.llama_url).rstrip("/")
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("COLLAPSEAI_LLAMA_URL must be an HTTP(S) server URL without credentials, query or fragment")
        port = int(os.environ.get("COLLAPSEAI_PORT", defaults.port))
        if not 1 <= port <= 65535:
            raise ValueError("COLLAPSEAI_PORT must be between 1 and 65535")
        return cls(
            name=os.environ.get("COLLAPSEAI_HUB_NAME", defaults.name),
            host=os.environ.get("COLLAPSEAI_HOST", defaults.host), port=port,
            pack_dir=path("COLLAPSEAI_PACK_DIR", defaults.pack_dir),
            manifest=path("COLLAPSEAI_MANIFEST", defaults.manifest),
            model_dir=path("COLLAPSEAI_MODEL_DIR", defaults.model_dir),
            map_dir=path("COLLAPSEAI_MAP_DIR", defaults.map_dir), llama_url=url,
            cors_origins=tuple(x.strip() for x in os.environ.get("COLLAPSEAI_CORS_ORIGINS", "").split(",") if x.strip()),
        )
