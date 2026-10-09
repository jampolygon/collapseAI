"""Actual local Uvicorn/HTTP smoke check, with no map, GGUF or successful AI fixture."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def main():
    port, upstream_port = free_port(), free_port()
    environment = {**os.environ, "COLLAPSEAI_LLAMA_URL": f"http://127.0.0.1:{upstream_port}"}
    with tempfile.TemporaryDirectory(prefix="collapseai-hub-smoke-") as temp:
        # Explicit absent resources; do not depend on the user's local installations.
        environment.update(COLLAPSEAI_MODEL_DIR=str(Path(temp) / "models"), COLLAPSEAI_MAP_DIR=str(Path(temp) / "maps"),
                           COLLAPSEAI_PACK_DIR=str(ROOT / "frontend/public/packs"), COLLAPSEAI_MANIFEST=str(ROOT / "frontend/public/manifest.json"))
        with (Path(temp) / "uvicorn.log").open("w+", encoding="utf-8") as log:
            process = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.hub.app:app", "--host", "127.0.0.1", "--port", str(port)],
                                       cwd=ROOT, env=environment, stdout=log, stderr=log,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            try:
                base = f"http://127.0.0.1:{port}"
                deadline = time.monotonic() + 15
                while True:
                    try:
                        with urlopen(f"{base}/health", timeout=3) as response:
                            health = json.load(response)
                        break
                    except URLError:
                        if process.poll() is not None or time.monotonic() >= deadline:
                            log.seek(0)
                            raise RuntimeError("Hub did not start: " + log.read())
                        time.sleep(0.1)
                assert health["status"] == "degraded" and health["hub"]["available"]
                with urlopen(f"{base}/api/info", timeout=4) as response:
                    info = json.load(response)
                assert len(info["packs"]) == 6 and all(pack["available"] for pack in info["packs"])
                assert not any(item["available"] for item in info["maps"])
                with urlopen(f"{base}/packs/first-aid.json", timeout=4) as response:
                    assert response.read() == (ROOT / "frontend/public/packs/first-aid.json").read_bytes()
                with urlopen(Request(f"{base}/packs/first-aid.json", headers={"Range": "bytes=0-31"}), timeout=4) as response:
                    assert response.status == 206 and len(response.read()) == 32
                    assert response.headers["Content-Range"].startswith("bytes 0-31/")
                for route, expected in (("/maps/luzon.pmtiles", 404), ("/models/absent.gguf", 404)):
                    try:
                        urlopen(f"{base}{route}", timeout=4)
                        raise AssertionError(f"Expected {expected} for {route}")
                    except HTTPError as exc:
                        assert exc.code == expected
                        exc.close()
                body = json.dumps({"messages": [{"role": "user", "content": "smoke request"}]}).encode()
                try:
                    urlopen(Request(f"{base}/v1/chat/completions", data=body, headers={"Content-Type": "application/json"}), timeout=4)
                    raise AssertionError("Expected unavailable local upstream")
                except HTTPError as exc:
                    assert exc.code == 503
                    exc.close()
                print("Real Uvicorn HTTP smoke passed: degraded health, 6 manifest packs, full/range pack transfer, missing maps/models, AI 503.")
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    main()
