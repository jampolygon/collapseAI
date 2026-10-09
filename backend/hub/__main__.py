"""Environment-aware launcher; Uvicorn CLI flags are an alternative."""
import uvicorn
from .config import Settings

if __name__ == "__main__":
    settings = Settings.from_env()
    uvicorn.run("backend.hub.app:app", host=settings.host, port=settings.port)
