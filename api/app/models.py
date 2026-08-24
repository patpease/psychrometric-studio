"""
The shape of a report request.

Every number in a report is computed by the browser and sent here already
solved. The API lays out; it does not calculate. That is not a shortcut — it is
what makes the two agree. A service that re-derived the duties from the state
points would eventually disagree with the chart the user is looking at, and the
report would be the thing that was wrong.

The one consequence to be honest about: this endpoint will faithfully typeset
whatever it is given. It is a rendering service, not a check on the client.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class Meta(BaseModel):
    name: Optional[str] = None
    project_number: Optional[str] = Field(default=None, alias="projectNumber")
    client: Optional[str] = None
    engineer: Optional[str] = None
    notes: Optional[str] = None

    model_config = {"populate_by_name": True}


class Provenance(BaseModel):
    """Stamped on every page. A report that cannot be traced is a liability."""

    application: str
    version: str
    calculation_basis: str = Field(alias="calculationBasis")
    library_version: str = Field(alias="libraryVersion")
    generated: str
    disclaimer: str

    model_config = {"populate_by_name": True}


class StatePoint(BaseModel):
    point: int
    name: str
    type: str
    tdb: Optional[float] = None
    twb: Optional[float] = None
    tdp: Optional[float] = None
    rh: Optional[float] = None
    w: Optional[float] = None
    h: Optional[float] = None
    v: Optional[float] = None
    airflow: Optional[float] = None
    mass_flow: Optional[float] = Field(default=None, alias="massFlow")
    error: Optional[str] = None

    model_config = {"populate_by_name": True}


class Load(BaseModel):
    point: int
    name: str
    type: str
    total: Optional[float] = None
    sensible: Optional[float] = None
    latent: Optional[float] = None
    shr: Optional[float] = None
    moisture: Optional[float] = None
    adp: Optional[float] = None
    bypass: Optional[float] = None
    note: Optional[str] = None

    model_config = {"populate_by_name": True}


class Totals(BaseModel):
    cooling: float = 0.0
    heating: float = 0.0
    humidification: float = 0.0
    dehumidification: float = 0.0
    net_sensible: float = Field(default=0.0, alias="netSensible")
    net_latent: float = Field(default=0.0, alias="netLatent")
    balance: Optional[str] = None

    model_config = {"populate_by_name": True}


class ReportRequest(BaseModel):
    meta: Meta = Field(default_factory=Meta)
    units: str = "IP"
    #: Already formatted by the client, e.g. "14.696 psia (standard, sea level)".
    #: Sent as prose rather than as a number because the *basis* is the point —
    #: a report that says only "14.696" cannot be checked.
    pressure: str = ""
    #: Unit labels, so the API never has to know an IP MBH from an SI kW.
    labels: Dict[str, str] = Field(default_factory=dict)
    state_points: List[StatePoint] = Field(default_factory=list, alias="statePoints")
    loads: List[Load] = Field(default_factory=list)
    totals: Totals = Field(default_factory=Totals)
    #: Base64 PNG of the chart, without a data: prefix. Optional: a report
    #: without a chart is still a useful document, and a failed rasterisation
    #: should not cost the user the tables.
    chart_png: Optional[str] = Field(default=None, alias="chartPng")
    provenance: Provenance

    model_config = {"populate_by_name": True}
