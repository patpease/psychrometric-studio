"""Application entry point."""
from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import __version__
from .models import ReportRequest
from .report import build_report

app = FastAPI(
    title="Psychrometric Studio API",
    version=__version__,
    description=(
        "Report rendering and reference-oracle endpoints. Stateless; retains no "
        "user data. The web application works without this service, except for "
        "PDF export."
    ),
)

#: Origins allowed to call this service.
#:
#: The front end is a static site on a different origin, so CORS is required
#: rather than optional. It is read from the environment because the deployment
#: origin is not knowable here, and a wildcard would let any page on the
#: internet post a user's project to this service and get a PDF back — harmless
#: in itself, but it makes the service an open renderer for anyone's traffic.
_origins = os.environ.get("PSYCHRO_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:5183")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in _origins.split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

#: Largest report request accepted.
#:
#: A chart rasterised at 2x is a few hundred kilobytes of base64; eight
#: megabytes is generous for that and still small enough that a malformed or
#: hostile request cannot make the process allocate its way out of memory.
MAX_REQUEST_BYTES = 8 * 1024 * 1024


@app.get("/health")
def health() -> dict:
    """Liveness probe. The front end uses this to decide whether to offer PDF export."""
    return {"status": "ok", "version": __version__}


@app.post("/report")
async def report(request: Request) -> Response:
    """
    Render a project as a branded PDF.

    The body is read by hand rather than through a Pydantic parameter so the
    size limit applies *before* anything large is parsed. Declaring the model as
    a parameter would have FastAPI read and decode the whole body first, which
    is the allocation this limit exists to prevent.
    """
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_REQUEST_BYTES:
        raise HTTPException(status_code=413, detail="That report request is too large to render.")

    body = await request.body()
    if len(body) > MAX_REQUEST_BYTES:
        raise HTTPException(status_code=413, detail="That report request is too large to render.")

    try:
        payload = ReportRequest.model_validate_json(body)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    try:
        pdf = build_report(payload)
    except Exception as error:  # noqa: BLE001 - a layout failure is a 500, not a crash loop
        raise HTTPException(
            status_code=500, detail="The report could not be rendered: {}".format(error)
        ) from error

    filename = (payload.meta.name or "psychrometric-study").replace('"', "")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="{}.pdf"'.format(filename)},
    )
