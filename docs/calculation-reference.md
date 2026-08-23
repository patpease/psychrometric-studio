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
