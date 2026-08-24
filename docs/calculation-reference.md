# Calculation reference

What this tool computes, what it is based on, and — importantly — **where it
knowingly disagrees with the printed ASHRAE tables and why**.

If you are comparing output against a published psychrometric chart or a
colleague's spreadsheet and seeing a small difference, §3 is almost certainly
the explanation.

---

## 1. Basis

| | |
|---|---|
| Property calculations | **PsychroLib 2.5.0**, vendored — see `web/vendor/PROVENANCE.md` |
| Formulation | ASHRAE Handbook — Fundamentals (2017), Chapter 1 |
| Comfort calculations | ASHRAE Standard 55-2023, via jsthermalcomfort *(Phase 3)* |
| Unit systems | IP primary, SI available; calculations run **natively** in each |

Every export carries the application version, library version, barometric
pressure, and unit system, so any result can be traced to the code that produced
it.

## 2. State determination

A moist-air state is fully determined by **dry-bulb temperature, humidity ratio,
and barometric pressure**. Every other property derives from those three.

Supported input pairs, and how each resolves:

| Entered | Resolution | Precision |
|---|---|---|
| Tdb + RH | `GetHumRatioFromRelHum` | exact |
| Tdb + Tdp | `GetHumRatioFromTDewPoint` | exact |
| Tdb + W | direct | exact |
| Tdb + h | `GetHumRatioFromEnthalpyAndTDryBulb` | exact |
| h + W | `GetTDryBulbFromEnthalpyAndHumRatio` | exact |
| Tdb + Twb | `GetHumRatioFromTWetBulb` | **iterative** — see §4 |
| Twb + RH | bisection on Tdb | **iterative** — see §4 |

"Exact" means agreement to machine precision on a round trip.

### Saturation clamping

A state above the saturation curve is physically impossible. Rather than
returning a nonsense value or silently truncating, the engine clamps the
humidity ratio to saturation **and records a warning on the state**, which the
interface surfaces. Silent clamping is how confusing numbers reach reports.

## 3. Known divergence from the ASHRAE tables

**This is expected behaviour, not a defect.**

PsychroLib implements the Chapter 1 *equations*, which treat moist air as a
mixture of ideal gases and omit the **water-vapour enhancement factor**. The
tables printed in Chapter 1 are computed from the real-gas formulation, which
includes it. The two therefore disagree, and the disagreement is not uniform:

| Quantity | Agreement with the published tables |
|---|---|
| Saturation vapour pressure (Table 3) | **0.03%** — excellent |
| Dry-air enthalpy and volume (Table 2) | 0.1% |
| Moist-air enthalpy, volume, density | 0.03% |
| **Saturated humidity ratio** (Table 2) | **up to 2%**, worst at the extremes |
| **Saturated air enthalpy** (Table 2) | **up to 3%**, worst near −5 °C |

Practically: at 25 °C and standard pressure, this tool computes a saturation
humidity ratio of 0.020081 kg/kg against a tabulated 0.020173 kg/kg — about
0.46% low. The divergence is largest **on and near the saturation curve** and
negligible in the middle of the chart where most design points sit.

These figures are asserted in `web/tests/reference-values.test.ts`, with the
per-point tolerances PsychroLib itself publishes. If a future release adds the
enhancement factor, that suite fails and this section must be revised.

## 4. Iterative precision — the noise floor

`GetTWetBulbFromHumRatio` and `GetTDewPointFromVapPres` are iterative and stop
once the bracket is narrower than `PSYCHROLIB_TOLERANCE`:

- **0.001 °C** in SI
- **0.0018 °F** in IP (the same absolute tolerance, converted)

Consequences, exported as `CONVERGENCE_TOLERANCE`:

- Wet-bulb temperature is resolved to about **±0.001 °C**.
- A humidity ratio obtained *through* a wet bulb carries about **4×10⁻⁷ kg/kg**
  — roughly 0.0004 g/kg, or 0.003 gr/lb.
- A dry bulb recovered from a wet-bulb pair carries about **4×10⁻⁴ degrees**.

This is far below engineering significance, but it is the **noise floor of the
entire application**. No solver, test, or displayed value should claim precision
finer than this. Tests asserting tighter agreement are asserting something the
calculation basis cannot deliver, and their failures will look like bugs in this
repository when they are not.

## 5. Unit conventions

Values are stored in PsychroLib's native units and converted only for display.

| Quantity | IP stored | IP shown | SI stored | SI shown |
|---|---|---|---|---|
| Temperature | °F | °F | °C | °C |
| Humidity ratio | lb/lb | gr/lb | kg/kg | g/kg |
| Enthalpy | Btu/lb | Btu/lb | **J/kg** | kJ/kg |
| Specific volume | ft³/lb | ft³/lb | m³/kg | m³/kg |
| Pressure | psia | psia | **Pa** | kPa |
| Relative humidity | 0–1 | 0–100% | 0–1 | 0–100% |
| Airflow | CFM | CFM | L/s | L/s |
| Mass flow | lb/**h** | lb/h | kg/**s** | kg/s |
| Duty | MBH | MBH | kW | kW |

Three traps, all encoded in `units.ts` and tested:

1. **PsychroLib SI enthalpy is J/kg, not kJ/kg.** A state at 24 °C / 50% RH
   returns roughly 47,000, not 47.
2. **Mass flow has a different time base in each system** — per hour in IP, per
   second in SI. This is conventional in each and is preserved deliberately;
   every downstream formula and label assumes it.
3. **Enthalpy does not convert between systems, because the datums differ.**
   See below — this is the one most likely to be reported as a bug.

### Enthalpy has a different zero in each system

IP moist-air enthalpy is referenced to **0 °F**; SI enthalpy is referenced to
**0 °C**. The scales are therefore *offset* as well as scaled, and no single
multiplier converts one to the other.

The same air — 80 °F / 51.2% RH at sea level — reads:

| | IP | SI |
|---|---|---|
| Dry bulb | 80.0 °F | 26.7 °C |
| Wet bulb | 67.0 °F | 19.5 °C |
| Humidity ratio | 78.4 gr/lb | 11.20 g/kg |
| Specific volume | 13.850 ft³/lb | 0.8646 m³/kg |
| **Enthalpy** | **31.48 Btu/lb** | **55.39 kJ/kg** |

Every row converts except the last. A naive 31.48 × 2.326 gives 73.2 kJ/kg, not
55.39 — the 17.8 kJ/kg gap is exactly `cp × 32 °F` expressed in kelvin
(1.006 × 17.78 = 17.9), the dry-air enthalpy of the datum offset.

So **switching unit systems in the application changes the enthalpy reading by
more than a unit conversion.** That is correct, and both values are right. Only
enthalpy *differences* — which is what every duty and load calculation actually
uses — are system-independent once converted, which is why this never affects a
result. The relationship is pinned in `tests/units.test.ts`.

## 5b. Thermal comfort

| | |
|---|---|
| Standard | ASHRAE 55-2023 |
| Library | `jsthermalcomfort` 1.4.0 (MIT), the JavaScript port of `pythermalcomfort` |
| Evaluation | **Always in SI**, whatever the application's unit system |

PsychroLib does not do comfort, so this is the one place a second library is
used. Three things about it are worth knowing.

**Everything is evaluated in SI.** The library offers an IP path, but it
converts air speed via feet per second, so 20 fpm arrives as 0.10058 m/s — just
above the 0.1 m/s threshold at which ASHRAE Appendix H begins computing a
cooling effect. The solver then cannot converge on an effect that is essentially
zero, warns, and falls back to zero. Converting at our own boundary avoids that,
and PMV is defined in SI regardless.

**Elevated air speed is credited.** The ASHRAE variant applies the SET-based
cooling effect of Appendix H before evaluating PMV, so raising air speed widens
the comfort zone toward warmer temperatures. At 27 °C, 0.5 clo, 1.1 met, PMV
falls from +0.53 at 0.1 m/s to −0.53 at 0.8 m/s. ASHRAE 55 requires occupants to
have control of that air movement, which the interface states.

**The adaptive model returns NaN, not null, outside its range.**
`JSON.stringify(NaN)` prints `null`, which makes the opposite appear true; a
`=== null` guard never fires and "NaN °F" reaches the interface. Only a
finiteness check is correct.

### The comfort zone

Built by sweeping relative humidity from 0 to 100% and, at each step, solving
for the dry-bulb temperature where PMV equals −0.5 and +0.5. PMV rises
monotonically with dry bulb — asserted in the tests — which makes bisection
safe. The top is clipped at **W = 0.012 kg/kg**, the 55-2023 upper humidity
limit; **55-2023 sets no lower limit**, and drawing one would be wrong.

The zone is plotted against **dry-bulb temperature**, not operative temperature.
The CBE tool switches its axis when radiant and air temperatures differ; this
chart cannot, because every other family on it is defined against dry bulb. The
radiant offset is carried as a parameter of the comfort calculation instead.

Boundary check at 50% RH, 1.1 met, still air:

| Zone | This tool | Published ASHRAE 55 |
|---|---|---|
| Winter, 1.0 clo | 20.3–24.5 °C | ≈ 20–24 °C |
| Summer, 0.5 clo | 23.9–26.9 °C | ≈ 23–26 °C |

## 6. Sign conventions

- **Duty is positive into the airstream.** Cooling therefore reads negative.
- Moisture rate is positive when moisture is added to the air.
- Effectiveness is a fraction from 0 to 1.

## 7. Site pressure

Barometric pressure is derived from site elevation by the standard atmosphere
(`GetStandardAtmPressure`), or entered directly. The basis is stored alongside
the value, so a report can state where the number came from rather than only
what it was.

The inverse — elevation implied by a pressure — has no PsychroLib equivalent and
is solved directly from the standard relation:

```
p = p₀ (1 − 2.25577×10⁻⁵ · z)^5.2559        z in metres, p in Pa
```

It is used only to *label* a chart with an equivalent elevation, never in the
calculation path.

## 8. Hand-derived inverses

PsychroLib is the source of truth wherever it provides a function. As of
Phase 0, exactly **one** inverse in the roadmap must be derived by hand:

| Needed for | Function | Status |
|---|---|---|
| Constant-enthalpy chart lines | W given (h, Tdb) | **Not needed** — `GetHumRatioFromEnthalpyAndTDryBulb` exists upstream |
| Constant specific-volume chart lines | W given (v, Tdb) | **Hand-derived** — Phase 1. Must round-trip against `GetMoistAirVolume` to 1e-9 |
| Elevation from pressure | §7 | Hand-derived, label-only |

The original plan assumed the enthalpy inverse would need deriving. It does not,
which removes one of the two places where an arithmetic slip could silently
distort the chart.

## 9. Process models

Every stage is a pure function from an entering state and a set of parameters to
a leaving state and a duty summary. Nothing is hidden between calls, and the
whole chain re-solves on every edit — cheaper than tracking which stages went
stale, and it makes it impossible for a downstream state to show a value from
before an edit.

### 9.1 The duty split

A stage's total duty is `ṁ_da · Δh`. Splitting it into sensible and latent parts
is done **at the entering humidity ratio**:

```
sensible = ṁ_da · [h(T_out, W_in) − h(T_in, W_in)]
latent   = total − sensible
```

This is the ASHRAE convention and it matters: enthalpy is *bilinear* in
(T, W) because `h = cp·T + W·(h_g + cpv·T)` carries a `T·W` cross term. Split at
the leaving humidity ratio instead and the two halves differ by a few tenths of
a percent — small, consistent, and the wrong number to hand a coil supplier.

SHR is `sensible / total`, and is **NaN when total duty is zero**. An undefined
ratio is reported as undefined rather than as 1.0, all the way out to the CSV
and the report, where it prints blank. A ratio of unity for a stage doing no
work is a lie the reader cannot detect.

### 9.2 Apparatus dew point and bypass factor

The ADP is the intersection of the extended process line with the saturation
curve. It is found by bisection on the function

```
g(T) = W_line(T) − W_sat(T, p)
```

walking **down** from the leaving dry bulb to the *first* sign change. That
detail is the whole of the correctness here: extended far enough, the process
line runs to negative humidity ratio, where `g` flips sign a second time. A
naive bracket across the full search range finds the same sign at both ends and
reports "no apparatus dew point" for an entirely ordinary coil.

Bypass factor is then the fraction of the entering-to-ADP interval not
traversed:

```
BF = (T_out − T_adp) / (T_in − T_adp)
```

Computed along **temperature**. Along humidity ratio it agrees to within the
convergence tolerance; along *enthalpy* it differs by about 0.3%, for the
bilinearity reason in §9.1 — the process line is straight in (T, W) and
therefore not straight in h. Two tests pin this: one asserting T and W agree,
one asserting enthalpy does not.

Where the line never reaches saturation there is no ADP, and the model says so
rather than extrapolating. A stage claiming latent capacity in that state is
flagged.

### 9.3 Energy recovery

Effectiveness is referenced to the **smaller of the two mass flows**, which is
what physically limits the transfer: a large exhaust stream cannot heat a small
supply stream beyond what the supply can absorb.

```
Q_max = ṁ_min · cp · (T_exhaust,in − T_supply,in)
```

The exhaust side is then derived from the energy and moisture actually
transferred, **not** from an equal and opposite temperature change. Equal ΔT
does not conserve energy when the two streams sit at different humidity ratios,
because their specific heats differ. The error is small and it is systematic,
which is worse than large and obvious.

Sensible and latent effectiveness are separate inputs for an enthalpy wheel. A
single quoted figure applied to both overstates latent recovery.

### 9.4 Fan heat

Fan power is entered as **shaft power** — HP in IP, kW in SI — because that is
how a fan is specified. The heat added to the airstream is derived from it:

- Motor in the airstream: all of it reaches the air.
- Motor outside: only the shaft power does.

Humidity ratio must not change across a fan, and a check enforces it.

### 9.5 Desiccant — an explicit idealisation

The desiccant wheel is modelled as **isenthalpic**: the state moves along a
constant-enthalpy line, drier and hotter. This is an idealisation, chosen
deliberately (PLAN §13 decision 2) and surfaced in the interface every time the
stage is selected.

Two things it does not model, both of which matter for design:

1. A real wheel runs slightly above the constant-enthalpy line.
2. It needs a regeneration airstream at 150–290 °F (65–140 °C), which is
   usually the dominant energy cost and is absent here entirely.

Size regeneration heat separately. Nothing in this tool will do it for you.

### 9.6 Evaporative and adiabatic processes

Direct evaporative cooling and adiabatic humidification are the same process
under two names: the state slides down a constant wet-bulb line toward
saturation, and effectiveness sets how far. The entering wet bulb is a **hard
floor** on the leaving dry bulb — enforced by the model, and checked again by a
design rule, because a violation there would mean the model itself is wrong.

Indirect evaporative cooling puts two effectivenesses in series — the
evaporative stage and the heat exchanger — so the achievable approach is worse
than either alone. The primary air moves horizontally: sensible cooling, no
moisture added.

## 10. Design checks

The checks surfaced beside a stage are engineering advice evaluated against the
solved state, not validation. Three rules govern them, and the tests enforce all
three:

1. **No check fires on the tool's own default system**, in either unit system. A
   tool that opens showing warnings has taught the user to ignore warnings by
   the second minute.
2. **Thresholds are declared in kelvin and converted.** A 3 K limit is 5.4 °F,
   and a rule comparing a Fahrenheit delta against 3 is wrong in one system of
   two.
3. **A check returns nothing rather than guessing** when the stage did not solve
   or the property it needs is absent.

Every message is worded as a question rather than a verdict. Advice that cannot
be evaluated — "use coincident design conditions" — stays prose rather than
being bent into a rule that fires on the wrong thing.
