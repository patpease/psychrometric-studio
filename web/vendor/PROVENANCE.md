# Vendored dependencies

## psychrolib.js

| Field | Value |
|---|---|
| Library version | **PsychroLib 2.5.0** (per the header comment in the file) |
| Source | https://github.com/psychrometrics/psychrolib — `src/js/psychrolib.js` @ `master` |
| SHA-256 | `a46572b93a90263b8e19e8d1372fe3135429aa9611cd57e00674188640cc96c9` |
| Fetched | 2026-08-22 |
| Licence | MIT — see `psychrolib.LICENSE.txt` |
| Modified | **No.** Byte-identical to upstream. |

Verify or refresh with `scripts/vendor-psychrolib.sh`. CI runs the verify form
on every build, so an unnoticed change to the calculation basis fails the build.

### Why vendored instead of `npm install psychrolib`

The npm package `psychrolib` is published from `nicfv/psychrolib-npm`, a
third-party republish, not by the psychrometrics organisation. Its package
version (`1.1.1` at time of writing) is the *wrapper repository's* version and
does not track the library version it contains (2.5.0). The file it ships is
byte-identical to upstream — verified by diff — so this is not a trust problem,
but it is a **traceability** problem: this tool stamps its calculation basis on
every exported report, and that stamp must resolve to a specific upstream
artifact rather than to a version number that means something else.

Vendoring also matches the approach taken by PsychPlotter, and removes a
runtime dependency on a wrapper repo that may lag upstream.

### Consumption

The file is UMD and exports a **singleton** with **module-global mutable unit
state** (`SetUnitSystem`). Do not import it directly. Use
`web/src/psych/psychrolib.ts`, which derives two independent instances — one
pinned to IP, one to SI — so that unit state is never mutated at runtime. See
`docs/adr/0002-dual-instance-unit-systems.md`.
