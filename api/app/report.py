"""
The branded PDF report.

ReportLab, laid out by hand rather than through a template engine. A report is
a fixed document with five sections and no conditional structure to speak of,
so a template would add a dependency and a second place to look without
removing any work.

Three things this file takes seriously.

**The stamp.** Application version, calculation basis, library version, site
pressure, unit system, and generation time appear on every page footer, not
once on the cover. Reports get printed, split, and stapled into other
documents; a page that leaves the set must still say where it came from.

**The disclaimer.** Present, unmissable, and not at the bottom of page four.
The tool models idealised processes and at least one of them ships as an
explicit idealisation.

**Failure.** A missing or corrupt chart image loses the chart and nothing else.
The tables are the part somebody checks.
"""
from __future__ import annotations

import base64
import binascii
from io import BytesIO
from typing import List, Optional, Sequence

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from .models import Load, ReportRequest, StatePoint

#: The identity green from the Pease Studio mark. Kept here rather than in a
#: shared constants module because the API is deliberately standalone — it
#: cannot import the front end's branding file, and pretending otherwise would
#: be a build coupling for the sake of one colour.
ACCENT = colors.HexColor("#0F5F52")
ACCENT_BRIGHT = colors.HexColor("#3FC98A")
INK = colors.HexColor("#14202B")
MUTED = colors.HexColor("#5D6B7A")
RULE = colors.HexColor("#D9DEE5")
BAND = colors.HexColor("#F2F5F4")

MARGIN = 0.6 * inch
FOOTER_HEIGHT = 0.55 * inch


def _styles() -> dict:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=22,
            alignment=TA_LEFT,
            textColor=INK,
            spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle", parent=base["Normal"], fontSize=9, leading=12, textColor=MUTED
        ),
        "heading": ParagraphStyle(
            "Heading",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=10.5,
            leading=13,
            textColor=ACCENT,
            spaceBefore=12,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "Body", parent=base["Normal"], fontSize=8.5, leading=11.5, textColor=INK
        ),
        "disclaimer": ParagraphStyle(
            "Disclaimer",
            parent=base["Normal"],
            fontSize=7.5,
            leading=10,
            textColor=MUTED,
            borderPadding=6,
            backColor=BAND,
        ),
    }


def _number(value: Optional[float], places: int) -> str:
    """A blank is more honest than a zero for a value that does not exist."""
    if value is None:
        return "—"
    try:
        return "{:,.{p}f}".format(float(value), p=places)
    except (TypeError, ValueError):
        return "—"


def _table(rows: Sequence[Sequence[str]], widths: Sequence[float]) -> Table:
    table = Table(list(rows), colWidths=list(widths), repeatRows=1, hAlign="LEFT")
    style = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.2),
        ("LEADING", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE),
    ]
    # Banding, so a reader tracking a value across eleven columns does not lose
    # the row. Applied per row rather than by a style range because ReportLab
    # has no nth-child.
    for index in range(1, len(rows)):
        if index % 2 == 0:
            style.append(("BACKGROUND", (0, index), (-1, index), BAND))
    table.setStyle(TableStyle(style))
    return table


def _state_point_table(points: List[StatePoint], labels: dict, width: float) -> Table:
    t = labels.get("temperature", "")
    header = [
        "#",
        "Stage",
        "Dry bulb\n({})".format(t),
        "Wet bulb\n({})".format(t),
        "Dew pt\n({})".format(t),
        "RH\n(%)",
        "W\n({})".format(labels.get("humidityRatio", "")),
        "h\n({})".format(labels.get("enthalpy", "")),
        "v\n({})".format(labels.get("specificVolume", "")),
        "Airflow\n({})".format(labels.get("airflow", "")),
        "Mass flow\n({})".format(labels.get("massFlow", "")),
    ]
    rows = [header]
    for p in points:
        if p.error:
            # Shown, not dropped. A stage silently missing from a schedule is
            # how a mistake survives review.
            rows.append([str(p.point), p.name, "did not solve: " + p.error, "", "", "", "", "", "", "", ""])
            continue
        rows.append(
            [
                str(p.point),
                p.name,
                _number(p.tdb, 1),
                _number(p.twb, 1),
                _number(p.tdp, 1),
                _number(None if p.rh is None else p.rh * 100, 1),
                _number(p.w, 2),
                _number(p.h, 2),
                _number(p.v, 3),
                _number(p.airflow, 0),
                _number(p.mass_flow, 0),
            ]
        )
    unit = width / 32.0
    return _table(rows, [unit * 1.2, unit * 5.8] + [unit * 2.5] * 9)


def _load_table(loads: List[Load], labels: dict, width: float) -> Table:
    d = labels.get("duty", "")
    header = [
        "#",
        "Stage",
        "Total\n({})".format(d),
        "Sensible\n({})".format(d),
        "Latent\n({})".format(d),
        "SHR",
        "Moisture\n({})".format(labels.get("moistureRate", "")),
        "ADP\n({})".format(labels.get("temperature", "")),
        "Bypass",
    ]
    rows = [header]
    for load in loads:
        rows.append(
            [
                str(load.point),
                load.name,
                _number(load.total, 1),
                _number(load.sensible, 1),
                _number(load.latent, 1),
                # An undefined ratio — zero total duty — printed as 1.000 would
                # be a lie the reader cannot detect.
                "—" if load.shr is None else _number(load.shr, 3),
                _number(load.moisture, 1),
                _number(load.adp, 1),
                _number(load.bypass, 3),
            ]
        )
    unit = width / 26.0
    return _table(rows, [unit * 1.2, unit * 6.8] + [unit * 2.6] * 7)


def _chart_flowable(encoded: str, width: float) -> Optional[Image]:
    """Decode the chart, or give up quietly and keep the tables."""
    try:
        payload = encoded.split(",", 1)[-1] if encoded.startswith("data:") else encoded
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        return None
    try:
        reader = ImageReader(BytesIO(raw))
        pixel_width, pixel_height = reader.getSize()
    except Exception:  # noqa: BLE001 - any decode failure means no chart, not no report
        return None
    if not pixel_width or not pixel_height:
        return None
    return Image(BytesIO(raw), width=width, height=width * pixel_height / float(pixel_width))


class _Report(BaseDocTemplate):
    """A document template whose footer knows the provenance."""

    def __init__(self, buffer: BytesIO, request: ReportRequest) -> None:
        super().__init__(
            buffer,
            pagesize=letter,
            leftMargin=MARGIN,
            rightMargin=MARGIN,
            topMargin=MARGIN,
            bottomMargin=MARGIN + FOOTER_HEIGHT,
            title=request.meta.name or "Psychrometric study",
            author=request.provenance.application,
            subject="Psychrometric analysis",
        )
        self.request = request
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="body",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=self._decorate)])

    def _decorate(self, canvas, document) -> None:  # noqa: ANN001 - ReportLab's signature
        canvas.saveState()
        page_width, _ = letter
        provenance = self.request.provenance

        y = MARGIN + FOOTER_HEIGHT - 6
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN, y, page_width - MARGIN, y)

        canvas.setFont("Helvetica", 6.5)
        canvas.setFillColor(MUTED)
        left = "{}  ·  v{}  ·  {}  ·  {}".format(
            provenance.application,
            provenance.version,
            provenance.library_version,
            self.request.pressure or "site pressure not recorded",
        )
        canvas.drawString(MARGIN, y - 9, left[:150])
        canvas.drawString(MARGIN, y - 18, provenance.disclaimer[:170])
        canvas.drawRightString(page_width - MARGIN, y - 9, "Page {}".format(document.page))
        canvas.drawRightString(page_width - MARGIN, y - 18, provenance.generated[:19].replace("T", " ") + " UTC")

        canvas.restoreState()


def build_report(request: ReportRequest) -> bytes:
    """Render the report and return the PDF bytes."""
    buffer = BytesIO()
    document = _Report(buffer, request)
    style = _styles()
    width = document.width
    story: list = []

    # -- masthead -------------------------------------------------------
    story.append(Paragraph(request.meta.name or "Psychrometric study", style["title"]))
    identity = " · ".join(
        part
        for part in (
            request.meta.project_number,
            request.meta.client,
            request.meta.engineer,
        )
        if part
    )
    if identity:
        story.append(Paragraph(identity, style["subtitle"]))
    story.append(
        Paragraph(
            "{} units · {}".format(request.units, request.pressure or "site pressure not recorded"),
            style["subtitle"],
        )
    )
    story.append(Spacer(1, 4))

    rule = Table([[""]], colWidths=[width], rowHeights=[2])
    rule.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), ACCENT_BRIGHT)]))
    story.append(rule)

    if request.meta.notes:
        story.append(Spacer(1, 8))
        story.append(Paragraph(request.meta.notes, style["body"]))

    # -- chart ----------------------------------------------------------
    if request.chart_png:
        chart = _chart_flowable(request.chart_png, width)
        if chart is not None:
            story.append(Spacer(1, 10))
            story.append(chart)

    # -- tables ---------------------------------------------------------
    if request.state_points:
        story.append(Paragraph("State points", style["heading"]))
        story.append(_state_point_table(request.state_points, request.labels, width))

    if request.loads:
        story.append(Paragraph("Process loads", style["heading"]))
        story.append(
            Paragraph(
                "Duties are positive into the airstream, so a cooling coil is negative.",
                style["subtitle"],
            )
        )
        story.append(Spacer(1, 3))
        story.append(_load_table(request.loads, request.labels, width))

    # -- totals ---------------------------------------------------------
    totals = request.totals
    duty = request.labels.get("duty", "")
    moisture = request.labels.get("moistureRate", "")
    story.append(Paragraph("System totals", style["heading"]))
    story.append(
        _table(
            [
                ["Quantity", "Value", "Unit"],
                ["Total cooling", _number(totals.cooling, 1), duty],
                ["Total heating", _number(totals.heating, 1), duty],
                ["Humidification", _number(totals.humidification, 1), moisture],
                ["Dehumidification", _number(totals.dehumidification, 1), moisture],
                ["Net sensible", _number(totals.net_sensible, 1), duty],
                ["Net latent", _number(totals.net_latent, 1), duty],
            ],
            [width * 0.4, width * 0.3, width * 0.3],
        )
    )
    if totals.balance:
        story.append(Spacer(1, 3))
        story.append(Paragraph(totals.balance, style["subtitle"]))

    # -- basis and disclaimer -------------------------------------------
    story.append(Paragraph("Calculation basis", style["heading"]))
    story.append(
        Paragraph(
            "{} — {}. Generated {} by {} version {}.".format(
                request.provenance.library_version,
                request.provenance.calculation_basis,
                request.provenance.generated,
                request.provenance.application,
                request.provenance.version,
            ),
            style["body"],
        )
    )
    story.append(Spacer(1, 8))
    story.append(Paragraph(request.provenance.disclaimer, style["disclaimer"]))

    document.build(story)
    return buffer.getvalue()
