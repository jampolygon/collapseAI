"""Proxy only the configured llama-server; no cloud fallback or redirects."""
import json

import anyio
import httpx
from fastapi import HTTPException, Request
from starlette.background import BackgroundTask
from starlette.responses import Response, StreamingResponse


async def llama_health(client: httpx.AsyncClient, url: str) -> dict:
    try:
        response = await client.get(f"{url}/health", timeout=2)
        return {"available": response.status_code == 200, "status": "ok" if response.status_code == 200 else "unavailable"}
    except httpx.HTTPError:
        return {"available": False, "status": "unavailable"}


async def chat_proxy(request: Request):
    try:
        payload = await request.json()
    except (ValueError, UnicodeError):
        raise HTTPException(400, "Expected a JSON chat request") from None
    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list) or not payload["messages"]:
        raise HTTPException(400, "messages must be a non-empty array")
    if not isinstance(payload.get("stream", False), bool):
        raise HTTPException(400, "stream must be a boolean")
    client = request.app.state.http_client
    url = request.app.state.settings.llama_url
    try:
        upstream = await client.send(client.build_request("POST", f"{url}/v1/chat/completions", json=payload,
                                                        headers={"Accept-Encoding": "identity"}), stream=True)
    except httpx.HTTPError:
        raise HTTPException(503, "Local llama-server is unavailable. Start it with a local GGUF and retry.") from None
    if upstream.status_code >= 500:
        await upstream.aclose()
        raise HTTPException(503, "Local llama-server is unavailable or still loading its model")
    if not payload.get("stream") or upstream.status_code != 200:
        try:
            content = await upstream.aread()
            return Response(content, status_code=upstream.status_code,
                            media_type=upstream.headers.get("content-type", "application/json"))
        except httpx.HTTPError:
            raise HTTPException(503, "Local llama-server connection failed while receiving the answer") from None
        finally:
            await upstream.aclose()
    if "text/event-stream" not in upstream.headers.get("content-type", ""):
        await upstream.aclose()
        raise HTTPException(502, "Local llama-server did not return an SSE stream")

    async def events():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        except httpx.HTTPError:
            # Headers already sent: an SSE error is possible, a new HTTP 503 is not.
            yield ("\n\ndata: " + json.dumps({"error": {"message": "Local llama-server stream disconnected", "type": "upstream_unavailable"}}) + "\n\n").encode()
        finally:
            with anyio.CancelScope(shield=True):
                await upstream.aclose()

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                             background=BackgroundTask(upstream.aclose))
