# Weather data

## Source and citation

Weather files come from **Climate.OneBuilding.org**. The TMYx data set must be
cited as:

> Lawrie, Linda K, Drury B Crawley. 2026. *Development of Global Typical
> Meteorological Years (TMYx)*. https://climate.onebuilding.org/

That citation appears in the weather panel whenever a file is loaded, and is
exported as `TMYX_CITATION` for inclusion in reports.

## How files get in

Download an archive from Climate.OneBuilding and drop it on the weather panel.
The `.zip` is opened in the browser and the `.epw` inside is read — no need to
extract it first, which matters because that is exactly how the site
distributes files.

**Nothing is uploaded.** The file is parsed in the browser and never leaves the
machine, which is the same promise the rest of the tool makes.

## Why there is no "download from Climate.OneBuilding" button

This was investigated as a stretch goal and **deferred to a later version**, for
a reason that is not about effort.

**Climate.OneBuilding sends no `Access-Control-Allow-Origin` header.** A browser
therefore refuses any cross-origin fetch to it — verified directly from a page
served at `localhost`:

```
fetch('https://climate.onebuilding.org/')
→ TypeError: Failed to fetch
```

That is the browser's same-origin policy working as designed, and no amount of
front-end code changes it. The host would have to opt in, and it is not ours.

The only way around it is to **proxy the download through a server**, which is
technically straightforward and carries three costs worth stating plainly:

1. **It breaks a design promise.** The application currently works with the API
   down; everything except PDF export degrades gracefully. Routing weather
   downloads through our server makes a core feature depend on it.
2. **It re-hosts someone else's bandwidth.** Climate.OneBuilding is a free
   academic service. Pulling their archives through a public tool at whatever
   rate our users generate, without asking, is not good citizenship. If this is
   built, it should start with an email to the maintainers.
3. **There is no search API to proxy.** The site is a directory tree of static
   files with no index endpoint. A usable "pick your city" feature needs a
   station index of several thousand entries, which means scraping their
   directory listings and then maintaining that index as it changes.

None of that is hard. All of it is a feature in its own right rather than a
stretch on this one, so it belongs in a version where it can be done properly —
with the maintainers' agreement and a station index that is kept current.

**The manual path is the supported one**, and is deliberately good: a direct
link, drag-and-drop, `.zip` handled, and the station's own elevation offered as
the chart pressure in one click.

## What is read, and what is done with it

An EPW is a CSV with eight header lines and 8,760 hourly records, always in SI.
This tool reads the location header and, per hour: dry-bulb temperature,
relative humidity, and **station pressure**.

Humidity ratio is computed at **each hour's own station pressure**, not at a
fixed site pressure. This matters at altitude: Denver's TMYx file reports
81,000–85,000 Pa, and computing humidity ratios at sea level would misplace
every point on the chart. Because the chart's own relative-humidity lines are
drawn at the *chart* pressure, the panel offers to adopt the file's elevation so
the two agree.

### Missing data

EPW marks missing values with sentinels — `99.9` for temperature, `999` for
relative humidity, `999999` for pressure. These are **values, not blanks**: a
99.9 °C hour plotted as read would sit far off the chart and drag every
statistic with it. Rows carrying a sentinel for a field this tool needs are
dropped and counted, and the count is reported. A missing *pressure* falls back
to the standard atmosphere at the site elevation rather than to sea level.

### Hours in the comfort zone

Hours are counted against the drawn comfort zone and the misses are classified,
because "62% of hours are outside the zone" is a number while "31% too warm,
24% too cool, 7% warm enough but too humid" is a brief that points at plant.

Each hour lands in exactly one bucket, and hours that miss on both axes are
attributed to **temperature**. A design condition of 35 °C at 40% RH sits above
an ASHRAE 55 zone's humidity cap, so a humidity-first rule would file it under
"too humid" when what it plainly is, is too hot — and that would argue for
dehumidification when what is needed is cooling.

## Performance

8,760 points are drawn on a **canvas** beneath the SVG chart, not as SVG nodes:
at that count SVG pans visibly badly. Binning the full year takes about 6 ms,
comfortably inside a frame, so the density map recomputes on every zoom rather
than being scaled.

## Fetching by link

The panel accepts a Climate.OneBuilding URL as well as a dropped file. It cannot
do so directly: that host sends no `Access-Control-Allow-Origin`, so a browser
fetch fails outright and a `no-cors` request returns an opaque body that cannot
be read — which is worse than an error, because it looks like success. Verified
twice, in Phase 5 and again when this was built.

The request therefore goes through `/api/weather`, a Cloudflare Pages Function
on the site's own origin. It fetches from **one host only**; an endpoint that
relays whatever URL it is handed is an open proxy, and the domain carries the
traffic. Once the bytes arrive, the path rejoins the dropped-file one — unzipped
and parsed in the browser — so "the file is not stored" stays true whichever way
it got there.

This relays one archive per deliberate user action: the same file, at the same
frequency, as downloading it by hand. That is a different proposition from the
station index Phase 5 declined to build, which would have crawled the site. If
usage grows past incidental, the right move is to ask Climate.OneBuilding rather
than to keep quiet.

## Design conditions

A Climate.OneBuilding archive contains a `.ddy` beside the `.epw`, and for
sizing work it is the more consequential of the two. The EPW is a *typical*
year — what the weather usually does. The DDY carries the ASHRAE design
conditions: the rare hours plant is actually sized against.

Dropping in the `.zip` reads both. Four conditions are extracted:

| Tag | Shown as | ASHRAE condition |
|---|---|---|
| HD | Heating design | Annual heating 99.6%, DB |
| CD | Cooling design | Annual cooling 0.4%, DB with mean coincident WB |
| DD | Dehumidification design | Annual cooling 0.4%, DP with mean coincident DB |
| ED | Enthalpy design | Annual cooling 0.4%, enthalpy with mean coincident DB |

DD and ED are there because **peak dry bulb and peak moisture do not coincide**.
A coil selected only against CD can be short on latent capacity; that is the
whole reason ASHRAE publishes the other two, and plotting all four together
makes the gap between them visible rather than a table lookup.

Each appears on the chart as a diamond with its tag — deliberately not the
numbered circle a process stage gets, because a design condition is something
the weather imposes rather than something the system does. Selecting one in the
panel highlights it on the chart, and the reverse.

### Two things the parser is careful about

**Fields are read by their `!-` comment, not by position.** Positional parsing
is the usual approach and it is brittle — EnergyPlus has changed the design-day
object's field list across versions, and the comment is what actually names a
value.

**The humidity field is reused.** `Wetbulb at Maximum Dry-Bulb` holds a wet bulb
*or* a dew point depending on the condition type declared two fields earlier,
and the enthalpy case puts its value elsewhere entirely. Reading the type first
is the only way to know what the number means — and the dehumidification day is
precisely the one where it is a dew point, so getting it wrong would misplot the
condition that was worth surfacing.

The four names are matched specifically rather than loosely. A DDY also contains
`Ann Htg Wind 99.6% Condns WS=>MCDB`, which a relaxed match on "Htg 99.6%" would
take as the heating design day and report a wind speed as a temperature.

**The field is named for the value it carries.** A wet-bulb condition writes
`Wetbulb at Maximum Dry-Bulb`; a dew-point one writes `Dewpoint at ...`. Both
are read, and so is the dictionary's own `Wetbulb or DewPoint at ...`. Reading
only the first loses every dehumidification day — which was the state of this
parser until a real file was put through it.

### Why the humidity ratio may not match the file's header

A dew-point design day gives dry bulb and dew point; the wet bulb shown in the
panel is solved from them. The `!` header comment above the object also states a
humidity ratio, and it will usually differ from what this tool derives by a few
tenths of a percent.

Neither is wrong. The header's figure is computed from the unrounded source
data, while the object states the dew point to one decimal. For Boston's
`DP=>MDB` day the header says `HR=0.0174`; solving from the stated 22.6 °C gives
0.01731, and 22.7 °C would give 0.01742 — the published value sits between them.
Station pressure is not the cause: across every plausible value it moves the
humidity ratio by about a hundredth of the gap.

This tool derives from the values in the object, because those are the ones it
can see and the ones the chart is drawn from.

### Using one for the entering condition

When a weather file is loaded, a source stage offers the four as a **Design
condition** selector. Choosing one fills in dry bulb and relative humidity, and
everything downstream re-solves. It is optional — with no file loaded, or with
"Entered manually" chosen, the stage behaves exactly as it always has.

The values are written into the stage rather than linked to it, so they stay
editable. Edit one and the selector returns to "Entered manually", because the
stage is no longer sitting on that condition and saying otherwise would be a
lie. Removing the weather file leaves the numbers in place: the design day was a
way of *entering* them, not a dependency.
