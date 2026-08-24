"""
The PDF report endpoint.

A PDF is awkward to assert on, so these tests check the things that actually go
wrong: that a well-formed request renders at all, that the parts a reader needs
in order to trust the document are present in the text layer, and — most
importantly — that the failure modes degrade rather than break.
"""
from __future__ import annotations

import base64
import io
import zlib

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _request(**overrides) -> dict:
    payload = {
        "meta": {"name": "Test AHU", "engineer": "PP", "client": "Acme"},
        "units": "IP",
        "pressure": "14.696 psia (standard, sea level)",
        "labels": {
            "temperature": "°F",
            "humidityRatio": "gr/lb",
            "enthalpy": "Btu/lb",
            "specificVolume": "ft³/lb",
            "airflow": "CFM",
            "massFlow": "lb/h",
            "duty": "MBH",
            "moistureRate": "lb/h",
        },
        "statePoints": [
            {
                "point": 1,
                "name": "Outdoor air",
                "type": "source",
                "tdb": 95.0,
                "twb": 75.1,
                "tdp": 66.7,
                "rh": 0.4,
                "w": 98.9,
                "h": 38.39,
                "v": 14.35,
                "airflow": 500,
                "massFlow": 2098,
            },
            {"point": 2, "name": "Broken stage", "type": "cooling", "error": "needs a leaving condition"},
        ],
        "loads": [
            {
                "point": 3,
                "name": "Cooling coil",
                "type": "cooling",
                "total": -75.5,
                "sensible": -54.9,
                "latent": -20.6,
                "shr": 0.727,
                "moisture": -19.0,
                "adp": 51.3,
                "bypass": 0.096,
            }
        ],
        "totals": {"cooling": -75.5, "heating": 56.8, "netSensible": -12.0, "netLatent": -3.0},
        "provenance": {
            "application": "Psychrometric Studio — Pease Studio",
            "version": "0.1.0",
            "calculationBasis": "ASHRAE Handbook — Fundamentals, Chapter 1 (2017)",
            "libraryVersion": "PsychroLib 2.5.0",
            "generated": "2026-08-24T12:00:00.000Z",
            "disclaimer": "For engineering analysis and education. Review and independently verify all results.",
        },
    }
    payload.update(overrides)
    return payload


def _pdf_text(pdf: bytes) -> str:
    """
    Pull readable text out of a PDF without a parser.

    ReportLab writes page content through ASCII85 and then Flate, so none of the
    strings are visible in the raw bytes — a naive substring check against the
    file passes only for the document metadata, which is not where the report
    is. Undoing both filters and concatenating what comes out is crude, but it
    is enough to assert that a phrase reached the page, which is all these tests
    need to know.
    """
    text = []
    for chunk in pdf.split(b"stream")[1:]:
        body = chunk.split(b"endstream")[0].strip(b"\r\n")
        for decode in (_ascii85_flate, zlib.decompress):
            try:
                text.append(decode(body).decode("latin-1"))
                break
            except Exception:  # noqa: BLE001 - a stream we cannot read is not a failure
                continue
    return "\n".join(text)


def _ascii85_flate(body: bytes) -> bytes:
    # The ASCII85 payload ends at its "~>" terminator; splitting on "endstream"
    # leaves the object's trailing newline and "endobj" behind it.
    end = body.index(b"~>") + 2
    return zlib.decompress(base64.a85decode(body[:end], adobe=True))


def test_renders_a_pdf() -> None:
    response = client.post("/report", json=_request())
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    assert b"%%EOF" in response.content


def test_carries_the_provenance_a_reader_needs() -> None:
    # These five facts are what make the document checkable six months later.
    text = _pdf_text(client.post("/report", json=_request()).content)
    for phrase in ("Test AHU", "PsychroLib 2.5.0", "14.696 psia", "independently verify", "0.1.0"):
        assert phrase in text, "{} missing from the report".format(phrase)


def test_shows_a_stage_that_did_not_solve_rather_than_dropping_it() -> None:
    # A row silently missing from a schedule is how a mistake survives review.
    text = _pdf_text(client.post("/report", json=_request()).content)
    assert "did not solve" in text


def test_an_undefined_shr_is_not_printed_as_a_number() -> None:
    payload = _request()
    payload["loads"][0]["shr"] = None
    text = _pdf_text(client.post("/report", json=payload).content)
    assert "0.727" not in text


def test_a_corrupt_chart_loses_the_chart_and_nothing_else() -> None:
    # The tables are the part somebody checks; they must survive a bad image.
    payload = _request(chartPng="not base64 at all !!!")
    response = client.post("/report", json=payload)
    assert response.status_code == 200
    assert "Test AHU" in _pdf_text(response.content)


def test_embeds_a_real_chart_image() -> None:
    png = base64.b64encode(_one_pixel_png()).decode("ascii")
    small = client.post("/report", json=_request()).content
    withChart = client.post("/report", json=_request(chartPng=png)).content
    assert len(withChart) > len(small)


def test_rejects_an_oversized_request() -> None:
    payload = _request(chartPng="A" * (9 * 1024 * 1024))
    response = client.post("/report", json=payload)
    assert response.status_code == 413


def test_rejects_a_request_with_no_provenance() -> None:
    payload = _request()
    del payload["provenance"]
    assert client.post("/report", json=payload).status_code == 422


def _one_pixel_png() -> bytes:
    """A minimal valid PNG, built rather than vendored."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            len(data).to_bytes(4, "big")
            + kind
            + data
            + (zlib.crc32(kind + data) & 0xFFFFFFFF).to_bytes(4, "big")
        )

    header = chunk(b"IHDR", (1).to_bytes(4, "big") + (1).to_bytes(4, "big") + bytes([8, 2, 0, 0, 0]))
    body = chunk(b"IDAT", zlib.compress(bytes([0, 255, 255, 255])))
    return b"\x89PNG\r\n\x1a\n" + header + body + chunk(b"IEND", b"")


def test_health_still_works() -> None:
    assert client.get("/health").json()["status"] == "ok"
