# Deploying

The web application is a static site with **one** server-side endpoint. Every
calculation happens in the browser, so there is no database and nothing kept —
which is also why there is nothing to back up and nothing to breach.

The exception is `/api/weather`, a Cloudflare Pages Function that relays a
weather archive from Climate.OneBuilding. It exists because that host sends no
CORS header, so a browser cannot read a response from it however the request is
phrased. Nothing is stored; the bytes pass through and are unzipped in the
browser exactly as a dropped file would be.

Every export, the PDF report included, runs in the reader's browser. There is no
second service to stand up and nothing to configure for it.

---

## The front end — Cloudflare Workers

Deployed through **Workers Builds**, not Pages. The two are different products
and the difference is not cosmetic: Pages resolves a `functions/` directory into
routes, and Workers does not. A `functions/` directory here is silently ignored,
and because static assets fall back to `index.html`, a route that was never
deployed answers **200 with the application shell** rather than 404. That is how
the weather relay came to look deployed when it was not.

Under Workers the routing is explicit instead: `worker/index.ts` owns every
request, handles `/api/weather`, and hands everything else to the assets
binding. `wrangler.jsonc` is what ties them together — **without its `main`
entry there is no script at all**, and every path goes straight to the assets.

### Project settings

| Setting | Value |
|---|---|
| Root directory | `web` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node version | 22 (set `NODE_VERSION=22` in the environment) |

The output directory is declared in `wrangler.jsonc` (`assets.directory`), not
in the dashboard.

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
| — | — | The front end needs none. |

There were two, both for the report service that no longer exists. A deploy is
the bundle and nothing else.

> One of them, `VITE_API_URL`, is worth remembering for the shape of the mistake
> rather than the variable. It named the report service's origin, and an early
> build defaulted it to `http://localhost:8000` so that a fresh checkout would
> work unconfigured. That is actively wrong once deployed: the URL resolves in
> the **visitor's** browser, so every page load probed port 8000 on their own
> machine. Any future build-time URL has the same trap in it.

### The weather relay

`web/worker/index.ts`, reached at `/api/weather`. It fetches from exactly one
host, and that allowlist is the whole security model: an endpoint that fetches
whatever URL it is handed is an open proxy, and your domain carries the traffic.

The checks live in `src/weather/proxy.ts`, which the Vite dev server also serves
in development — so the logic running at the edge is the logic exercised
locally, and the Worker is an adapter with no decisions in it.

**Run it locally before deploying.** Wrangler is a devDependency, so this needs
no setup and exercises the real Workers runtime rather than a stand-in:

```bash
npm run preview:worker
```

That serves the built site and the relay together on port 8788 — the production
shape. It was added after a deployment shipped a relay that had never run
anywhere.

**And verify after deploying:**

```bash
curl -sI "https://YOUR-SITE.workers.dev/api/weather?url=https://climate.onebuilding.org/WMO_Region_4_North_and_Central_America/ABW_Aruba/ABW_AA_Queen.Beatrix.Intl.AP.789820_TMYx.2009-2023.zip" | head -3
```

`200` with `content-type: application/zip` means it is live.

**`200` with `content-type: text/html` means it is not** — the request fell
through to the application shell, so the Worker either has no `main` entry or
was not deployed. That is the failure this endpoint actually had, and it is why
the interface checks the content type rather than the status code: a 200 that
is secretly HTML would otherwise reach the unzipper and be reported as a corrupt
archive.

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
  design. Nothing else in the tool talks to anything: the PDF report is drawn in
  the browser, so this line needs no exception and should not acquire one.

The policy was verified against a production build with every export exercised:
project file, CSV, SVG, PNG, and share link, with zero violations.

### Custom domain

When one is settled, two things change:

1. Add `<meta property="og:url">` and a `<link rel="canonical">` to
   `web/index.html`. Both are deliberately absent now — a hard-coded canonical
   that disagrees with the address bar tells crawlers the page lives somewhere
   it does not.
2. Nothing else — there is no second origin to tell about the move.

---

## The report — nothing to deploy

The PDF report is generated in the reader's browser by jsPDF, so there is no
service, no environment variable, and no `connect-src` exception to remember.
It works on a plain static deploy the moment the bundle is up.

It did not always. Through v1.0 the report was rendered by a FastAPI service in
`api/`, which was written, tested, and never once deployed — which is the honest
measure of what an always-on process costs a tool like this. Moving the
rendering into the browser removed a container, a cold start, a CORS rule and a
permanent hole in the content security policy, and it made "nothing is uploaded"
literally true rather than true-because-the-service-is-off. That directory and
its CI job are gone; the history is in `PLAN.md` and in the log.

One consequence worth knowing: the three PDF libraries come to about 155 kB
gzipped and are fetched on the first click rather than on every visit. That is
the one feature in the tool that needs the network after first load.

---

## The feedback address — when a mail link stops being enough

The feedback control in the right-hand panel opens the reader's own mail client.
The address is never in the markup: it is stored ROT13'd in two halves and
assembled on click, so neither of the two regexes an address harvester runs —
one for `mailto:` hrefs, one for anything shaped like `name@host.tld` — finds
anything in the served page. `web/tests/contact.test.ts` pins that, and pins it
by hash rather than by writing the address into a public repository.

**This is a speed bump, not a wall.** A crawler that renders the page and clicks
things gets the address, and more of them do every year. If the spam ever
outgrows Gmail's filtering, the fix is to stop putting the address on the page
at all:

1. Add a `POST /api/feedback` route to `web/worker/index.ts`, beside the weather
   relay. It reads a JSON body and forwards it to a transactional email API —
   Resend, Postmark, and SendGrid all have a free tier that covers a tool this
   size. MailChannels no longer offers the free Workers integration.
2. Put the destination address and the API key in Worker secrets
   (`npx wrangler secret put FEEDBACK_TO`). Secrets are not in the bundle, not
   in the repository, and not in `wrangler.jsonc`.
3. Replace the mail button with a textarea and a submit that `fetch`es the
   route. **`connect-src 'self'` already permits this** — the request is
   same-origin, which is the point of putting the route on the Worker rather
   than posting to a third-party form service. A third-party endpoint would need
   its origin adding to `connect-src` in `web/public/_headers`.
4. Rate-limit it. An open mail relay behind a public form is a spam problem
   pointed at your own address rather than away from it: cap by IP in a
   Durable Object or KV, and drop anything with a filled honeypot field.

The trade is one route, one API key, and a form the reader fills in on the page
instead of in the mail client they already know how to use. Worth it when the
address is being harvested; not worth it before.

## Verifying a deployment

- The chart draws, and the five starter stages each show an icon.
- The **About this tool** panel opens and links to `/third-party-notices.txt`,
  which returns plain text.
- Save, CSV, SVG, PNG, and a share link all produce files.
- Following a share link opens the project and clears the fragment.
- The browser console is clean — in particular, no CSP violations.
- The PDF report downloads two pages for a two-case project, with the chart as
  selectable vector and the footer stamp on both pages.
