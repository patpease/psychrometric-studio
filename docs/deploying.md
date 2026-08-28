# Deploying

The web application is a static site with **one** server-side endpoint. Every
calculation happens in the browser, so there is no database and nothing kept —
which is also why there is nothing to back up and nothing to breach.

The exception is `/api/weather`, a Cloudflare Pages Function that relays a
weather archive from Climate.OneBuilding. It exists because that host sends no
CORS header, so a browser cannot read a response from it however the request is
phrased. Nothing is stored; the bytes pass through and are unzipped in the
browser exactly as a dropped file would be.

The PDF report service is optional and **v1 ships without it**. The tool detects
its absence and hides the one button that needs it.

---

## The front end — Cloudflare Pages

### Project settings

| Setting | Value |
|---|---|
| Framework preset | None |
| Root directory | `web` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 22 (set `NODE_VERSION=22` in the environment) |

**The root directory is the setting that actually matters**, and on the project
creation screen it is collapsed behind an *Advanced* disclosure that is easy to
miss. There is no `package.json` at the repository root, so a build that skips
it fails immediately:

```
npm error path /opt/buildhome/repo/package.json
npm error enoent Could not read package.json
```

The give-away in the log is the line **"No dependencies detected to cache"**
followed by the build command running with no install step in between —
Cloudflare found no manifest to install from. Set the root directory to `web`
and redeploy.

**The output directory is relative to the root directory**, not to the
repository. With the root set to `web`, the build writes `web/dist` and
Cloudflare is looking for `dist`. Getting this the other way round is the other
common failure — a green build that publishes nothing, with "Output directory
not found" at the end of the log.

`npm run build` regenerates the icon module and the third-party notices, type
checks, and then builds. The generated files are committed, so the build is
reproducible either way — but regenerating means a changed SVG or a new
dependency cannot ship as last week's output.

### Environment variables

Exactly one, and **it should be left unset** for a build without the report
service:

| Variable | When to set it | Effect |
|---|---|---|
| `VITE_API_URL` | Only once a report service is deployed | Origin of the service, e.g. `https://api.example.com`. No trailing slash. |

Unset means *there is no service*. The application then skips the health check
entirely and does not offer PDF export.

> An earlier build defaulted this to `http://localhost:8000` so a fresh checkout
> would work without configuration. That is actively wrong in production: the
> URL resolves in the **visitor's** browser, so every page load would probe port
> 8000 on their machine. Development sets it in `web/.env.development`, which is
> checked in because it is not a secret.

### The weather relay

`web/functions/api/weather.ts` deploys automatically with the site — Pages picks
up a `functions` directory relative to the **root directory**, which is why it
lives under `web/` rather than at the repository root. No configuration, no
separate service, no environment variable.

It will fetch from exactly one host, and that allowlist is the whole security
model: an endpoint that fetches whatever URL it is handed is an open proxy, and
your domain carries the traffic. The checks live in `src/weather/proxy.ts`,
which the Vite dev server also serves in development — so the logic that runs at
the edge is the logic exercised locally, and the Function itself is a dozen
lines of adapter.

**Verify it after the first deploy.** It is the one part of the system that
cannot be exercised on a developer's machine without Wrangler:

```bash
curl -sI "https://YOUR-SITE.pages.dev/api/weather?url=https://climate.onebuilding.org/WMO_Region_4_North_and_Central_America/ABW_Aruba/ABW_AA_Queen.Beatrix.Intl.AP.789820_TMYx.2009-2023.zip" | head -3
```

`200` with `content-type: application/zip` means it is live. A `404` means Pages
did not find the `functions` directory — check the root directory setting. The
interface says so plainly in that case rather than blaming the network.

### Headers

`web/public/_headers` is copied into the build output and applied by Pages. It
sets a content security policy, caching, and the usual hardening. The policy is
tight because the tool genuinely makes no third-party requests — three
exceptions, each with a reason recorded beside it in the file:

- `img-src data: blob:` — chart export embeds the weather layer as a data URI,
  then loads the serialised SVG through a blob URL to rasterise it.
- `style-src 'unsafe-inline'` — React writes inline style attributes and the
  chart sets stroke and fill per element. There is no way to hash those.
- `connect-src 'self'` — covers the weather relay, which is same-origin by
  design. **Must be widened if a report service is deployed**, or the browser
  blocks that request no matter what `VITE_API_URL` says.

The policy was verified against a production build with every export exercised:
project file, CSV, SVG, PNG, and share link, with zero violations.

### Custom domain

When one is settled, two things change:

1. Add `<meta property="og:url">` and a `<link rel="canonical">` to
   `web/index.html`. Both are deliberately absent now — a hard-coded canonical
   that disagrees with the address bar tells crawlers the page lives somewhere
   it does not.
2. Add the domain to `PSYCHRO_ALLOWED_ORIGINS` on the report service, if one is
   running.

---

## The report service — when you want it

Not deployed for v1. The code is complete, tested, and ready.

```bash
cd api
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/python -m uvicorn app.main:app --port 8000
```

It is a stateless FastAPI application that renders a PDF from JSON and keeps
nothing. It **lays out; it does not calculate** — every number arrives already
solved from the browser, which is what keeps the report and the on-screen chart
in agreement.

### Its environment variable

| Variable | Default | Effect |
|---|---|---|
| `PSYCHRO_ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:5183` | Comma-separated origins allowed to call the service. |

This must name the deployed front end exactly — scheme, host, and port if
non-standard. A wildcard would make the service an open renderer for anyone's
traffic, which is why there is no default that would allow one.

### Deploying it

Any container host will do; it needs one small always-on process. Three things
to get right:

1. `PSYCHRO_ALLOWED_ORIGINS` set to the front end's origin.
2. `VITE_API_URL` set to the service's origin **at front-end build time** — it
   is compiled into the bundle, so changing it needs a rebuild, not a restart.
3. `connect-src` in `web/public/_headers` widened to include the service origin.

Miss the third and the button appears and then fails, which is the worst of the
three outcomes. Miss the first and the browser refuses the request. Miss the
second and the button never appears at all — the safe failure, and the one the
tool is designed around.

---

## Verifying a deployment

- The chart draws, and the five starter stages each show an icon.
- The **About this tool** panel opens and links to `/third-party-notices.txt`,
  which returns plain text.
- Save, CSV, SVG, PNG, and a share link all produce files.
- Following a share link opens the project and clears the fragment.
- The browser console is clean — in particular, no CSP violations.
- If no report service is deployed, the export panel says so plainly and offers
  no PDF button.
