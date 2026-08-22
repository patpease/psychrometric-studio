"""Application entry point."""
from fastapi import FastAPI

from . import __version__

app = FastAPI(
    title="Psychrometric Studio API",
    version=__version__,
    description=(
        "Report rendering and reference-oracle endpoints. Stateless; retains no "
        "user data. The web application works without this service, except for "
        "PDF export."
    ),
)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe. The front end uses this to decide whether to offer PDF export."""
    return {"status": "ok", "version": __version__}
