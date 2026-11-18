from __future__ import annotations

import asyncio
import json
import re
from typing import AsyncGenerator

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from knowledge_engine import ArgosKnowledgeEngine

app = FastAPI(
    title="Root SRE Backend — Proyecto ARGOS",
    description=(
        "Backend FastAPI con streaming SSE conectado directamente a `agente.md` e `infra_argos.md` "
        "(sin conexión a modelos de IA externos)."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = ArgosKnowledgeEngine()


class ChatStreamRequest(BaseModel):
    prompt: str


async def sse_token_generator(prompt: str, request: Request) -> AsyncGenerator[str, None]:
    """
    Genera eventos Server-Sent Events (SSE) en tiempo real (`text/event-stream`)
    a partir de la respuesta construida con `agente.md` e `infra_argos.md`.
    """
    full_response = engine.generate_sre_response(prompt)

    # Fragmentar preservando saltos de línea y formato de código para simular el flujo de terminal
    chunks = re.findall(r".{1,14}|\n", full_response)

    for chunk in chunks:
        if await request.is_disconnected():
            break
        payload = json.dumps({"token": chunk}, ensure_ascii=False)
        yield f"data: {payload}\n\n"
        await asyncio.sleep(0.016)

    yield "event: done\ndata: [DONE]\n\n"


@app.get("/api/health")
async def health_check() -> dict:
    """Verifica el estado del servidor FastAPI y los archivos `agente.md` e `infra_argos.md`."""
    return engine.get_metadata()


@app.get("/api/context")
async def get_loaded_context() -> dict:
    """
    Devuelve las secciones parseadas y el System Prompt completo unificado
    (`agente.md` + `infra_argos.md`) que usa el backend.
    """
    meta = engine.get_metadata()
    return {
        **meta,
        "unified_system_prompt": engine.build_full_system_prompt(),
    }


@app.post("/api/chat/stream")
async def chat_stream_post(body: ChatStreamRequest, request: Request) -> StreamingResponse:
    """Endpoint SSE por POST (ideal para pegados masivos de logs de systemd/InfluxDB)."""
    return StreamingResponse(
        sse_token_generator(body.prompt, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/chat/stream")
async def chat_stream_get(
    request: Request,
    prompt: str = Query(default="", description="Síntoma o log enviado por EventSource GET"),
) -> StreamingResponse:
    """Endpoint SSE por GET (compatible con API nativa `new EventSource('/api/chat/stream?prompt=...')`)."""
    return StreamingResponse(
        sse_token_generator(prompt, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
