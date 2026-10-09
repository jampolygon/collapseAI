"""Bounded, single-range downloads from explicitly configured resource roots."""
import hashlib
import os
import re
from pathlib import Path

from fastapi import HTTPException, Request
from starlette.background import BackgroundTask
from starlette.responses import Response, StreamingResponse

FILENAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,199}\Z")
CHUNK_SIZE = 256 * 1024


def resource_path(root: Path, filename: str, suffix: str) -> Path:
    if not FILENAME.fullmatch(filename) or ".." in filename or not filename.lower().endswith(suffix):
        raise HTTPException(400, "Invalid resource filename")
    try:
        root = root.resolve()
        candidate = (root / filename).resolve()
        if candidate.parent != root or not candidate.is_file():
            raise HTTPException(404, "Resource not found")
        return candidate
    except (OSError, RuntimeError):
        raise HTTPException(404, "Resource not found") from None


def byte_range(value: str, size: int) -> tuple[int, int]:
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value.strip())
    if not match or not any(match.groups()) or size == 0:
        raise ValueError("Unsupported or unsatisfiable range")
    first, last = match.groups()
    if first:
        start = int(first)
        end = min(int(last), size - 1) if last else size - 1
        if start >= size or end < start:
            raise ValueError("Unsatisfiable range")
    else:
        length = int(last)
        if length <= 0:
            raise ValueError("Unsatisfiable suffix range")
        start, end = max(0, size - length), size - 1
    return start, end


def serve_file(request: Request, root: Path, filename: str, suffix: str):
    path = resource_path(root, filename, suffix)
    try:
        file = path.open("rb")
        stat = os.fstat(file.fileno())
    except OSError:
        raise HTTPException(404, "Resource cannot be opened") from None
    size = stat.st_size
    # A change validator, not a content checksum. Open descriptor fixes replacement races.
    etag = '"' + hashlib.sha256(f"{stat.st_ino}:{size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}".encode()).hexdigest() + '"'
    headers = {"Accept-Ranges": "bytes", "ETag": etag, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"}
    start, end, status = 0, size - 1, 200
    value = request.headers.get("range")
    if value is not None and request.headers.get("if-range", etag) == etag:
        try:
            start, end = byte_range(value, size)
        except (ValueError, OverflowError):
            file.close()
            return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}", "Content-Length": "0"})
        status = 206
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    length = max(0, end - start + 1)
    headers["Content-Length"] = str(length)
    media_type = "application/json" if suffix == ".json" else "application/octet-stream"
    if request.method == "HEAD":
        file.close()
        return Response(status_code=status, headers=headers, media_type=media_type)

    def chunks():
        try:
            file.seek(start)
            remaining = length
            while remaining:
                chunk = file.read(min(CHUNK_SIZE, remaining))
                if not chunk:
                    raise OSError("Resource changed during download")
                remaining -= len(chunk)
                yield chunk
        finally:
            file.close()

    return StreamingResponse(chunks(), status_code=status, headers=headers, media_type=media_type,
                             background=BackgroundTask(file.close))
