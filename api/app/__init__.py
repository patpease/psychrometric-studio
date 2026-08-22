"""Psychrometric Studio API.

Deliberately thin. The browser owns every interactive calculation; this service
exists for work that genuinely needs a server:

  * ``report``          — branded PDF via ReportLab
  * ``chart_render``    — print-quality vector chart for PDF embedding
  * ``comfort_oracle``  — pythermalcomfort reference values, used by CI to
                          cross-check the browser's jsthermalcomfort results

It is stateless and holds no user data. The front end must remain fully
functional when this service is unavailable; only PDF export degrades.

See PLAN.md §3.2.
"""

__version__ = "0.1.0"
