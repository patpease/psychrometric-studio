/**
 * Design-day parsing.
 *
 * The fixture below is shaped like a real Climate.OneBuilding `.ddy`: the four
 * conditions this tool wants, mixed in with the ones it must ignore. Those
 * decoys are the point — a DDY holds a dozen or more design days, and several
 * have names close enough to the wanted ones that a loose match picks up a wind
 * speed and reports it as a temperature.
 *
 * **The humidity field changes its name with the condition type**, and an
 * earlier version of this file did not: it labelled every one `Wetbulb at
 * Maximum Dry-Bulb`, matching what the parser looked for, so the suite agreed
 * with the bug and a real file lost its dehumidification day. The verbatim
 * block at the end of this file exists so that cannot happen again — it is
 * copied from an actual download rather than generated from the same
 * assumptions as the code.
 */
import { describe, it, expect } from 'vitest';
import { parseDdy, convertDesignDays } from '../src/weather/ddy.js';
import { fromTdbTdp } from '../src/psych/state.js';
import { humidityRatioToDisplay } from '../src/psych/units.js';

/** One design-day object, with the field comments a real file carries. */
function designDay(
  name: string,
  maxDb: string,
  humidityType: string,
  humidityValue: string,
  enthalpy = '',
  humidityRatio = '',
): string {
  return ` SizingPeriod:DesignDay,
  ${name},     !- Name
          7,      !- Month
         21,      !- Day of Month
  SummerDesignDay,!- Day Type
      ${maxDb},      !- Maximum Dry-Bulb Temperature {C}
        9.4,      !- Daily Dry-Bulb Temperature Range {C}
 DefaultMultipliers, !- Dry-Bulb Temperature Range Modifier Type
           ,      !- Dry-Bulb Temperature Range Modifier Day Schedule Name
    ${humidityType},      !- Humidity Condition Type
      ${humidityValue},      !- ${humidityType === 'Dewpoint' ? 'Dewpoint' : 'Wetbulb'} at Maximum Dry-Bulb {C}
           ,      !- Humidity Indicating Day Schedule Name
      ${humidityRatio},      !- Humidity Ratio at Maximum Dry-Bulb {kgWater/kgDryAir}
      ${enthalpy},      !- Enthalpy at Maximum Dry-Bulb {J/kg}
           ,      !- Daily Wet-Bulb Temperature Range {deltaC}
    101281.,      !- Barometric Pressure {Pa}
        5.3,      !- Wind Speed {m/s} design conditions vs. traditional 6.71 m/s (15 mph)
        230,      !- Wind Direction {Degrees; N=0, S=180}
         No,      !- Rain {Yes/No}
         No,      !- Snow on ground {Yes/No}
         No,      !- Daylight Savings Time Indicator
  ASHRAETau, !- Solar Model Indicator
           ,      !- Beam Solar Day Schedule Name
           ,      !- Diffuse Solar Day Schedule Name
      0.417,      !- ASHRAE Clear Sky Optical Depth for Beam Irradiance (taub)
      2.135;      !- ASHRAE Clear Sky Optical Depth for Diffuse Irradiance (taud)
`;
}

const STATION = 'Boston-Logan.Intl.AP';

const FIXTURE = [
  `! ${STATION}_MA_USA Annual Heating Design Conditions Wind Speed=7.1m/s Wind Dir=300`,
  '! Coldest Month=JAN',
  designDay(`${STATION} Ann Htg 99.6% Condns DB`, '-13.1', 'Wetbulb', '-13.1'),
  // Decoys: names close enough that a loose pattern would take them.
  designDay(`${STATION} Ann Htg Wind 99.6% Condns WS=>MCDB`, '-2.6', 'Wetbulb', '-4.4'),
  designDay(`${STATION} Ann Htg 99% Condns DB`, '-9.7', 'Wetbulb', '-9.7'),
  designDay(`${STATION} Ann Clg .4% Condns DB=>MWB`, '32.2', 'Wetbulb', '22.5'),
  designDay(`${STATION} Ann Clg 1% Condns DB=>MWB`, '30.1', 'Wetbulb', '21.8'),
  designDay(`${STATION} Ann Clg .4% Condns WB=>MDB`, '29.4', 'Wetbulb', '24.1'),
  designDay(`${STATION} Ann Clg .4% Condns DP=>MDB`, '27.2', 'Dewpoint', '22.9'),
  designDay(`${STATION} Ann Clg .4% Condns Enth=>MDB`, '30.4', 'Enthalpy', '', '73400.'),
].join('\n');

describe('parsing a design-day file', () => {
  const parsed = parseDdy(FIXTURE, 'IP');
  const byTag = new Map(parsed.days.map((day) => [day.tag, day]));

  it('finds exactly the four wanted conditions', () => {
    expect(parsed.days.map((day) => day.tag)).toEqual(['HD', 'CD', 'DD', 'ED']);
    expect(parsed.problems).toEqual([]);
  });

  it('takes the heating day rather than the wind day that looks like it', () => {
    // "Ann Htg Wind 99.6% Condns WS=>MCDB" sits right beside the one we want.
    // Matching it would report −2.6 °C as the heating design temperature.
    expect(byTag.get('HD')!.name).toContain('Condns DB');
    expect(byTag.get('HD')!.name).not.toContain('Wind');
    expect(byTag.get('HD')!.state.tdb).toBeCloseTo(8.42, 1); // −13.1 °C
  });

  it('takes the 0.4% cooling day, not the 1%', () => {
    expect(byTag.get('CD')!.state.tdb).toBeCloseTo(89.96, 1); // 32.2 °C
  });

  it('reads a dew-point condition as a dew point, not a wet bulb', () => {
    // The humidity field is reused across condition types. Read as a wet bulb,
    // 22.9 °C would give a *drier* state than the truth — on the one day whose
    // whole purpose is to be the moist one.
    const dd = byTag.get('DD')!;
    expect(dd.humidityBasis).toBe('Dew point');
    expect(dd.state.tdp).toBeCloseTo(73.22, 1); // 22.9 °C
    expect(dd.state.twb).toBeGreaterThan(dd.state.tdp);
  });

  it('gives the dehumidification day more moisture than the cooling day', () => {
    // The reason ASHRAE publishes it: peak dry bulb and peak moisture do not
    // coincide, and a coil sized only on CD can be short on latent.
    expect(byTag.get('DD')!.state.w).toBeGreaterThan(byTag.get('CD')!.state.w);
  });

  it('solves an enthalpy condition through SI, where the datum is right', () => {
    // 73.4 kJ/kg at 30.4 °C. Enthalpy does not convert between unit systems, so
    // this is solved in SI and carried across as a humidity ratio.
    const ed = byTag.get('ED')!;
    expect(ed.humidityBasis).toBe('Enthalpy');
    expect(ed.state.tdb).toBeCloseTo(86.72, 1);
    expect(humidityRatioToDisplay(ed.state.w, 'IP')).toBeGreaterThan(90);
  });

  it('carries the file’s own barometric pressure', () => {
    expect(byTag.get('CD')!.pressure).toBeCloseTo(101281 / 6894.757, 3);
  });

  it('reads the date each condition falls on', () => {
    expect(byTag.get('CD')!.month).toBe(7);
    expect(byTag.get('CD')!.day).toBe(21);
  });
});

describe('when the file is not what was expected', () => {
  it('reports a file with no design days at all', () => {
    const parsed = parseDdy('! just a comment\n', 'IP');
    expect(parsed.days).toEqual([]);
    expect(parsed.problems[0]).toContain('No design days');
  });

  it('returns the conditions it found and names the ones it did not', () => {
    // Partial design data is still worth showing; the alternative is a weather
    // import that fails because of a secondary file.
    const parsed = parseDdy(designDay(`${STATION} Ann Htg 99.6% Condns DB`, '-13.1', 'Wetbulb', '-13.1'), 'IP');
    expect(parsed.days.map((d) => d.tag)).toEqual(['HD']);
    expect(parsed.problems).toHaveLength(3);
    expect(parsed.problems.join(' ')).toContain('cooling design');
  });

  it('reports an unreadable humidity type rather than guessing', () => {
    const parsed = parseDdy(
      designDay(`${STATION} Ann Clg .4% Condns DB=>MWB`, '32.2', 'Schedule', ''),
      'IP',
    );
    expect(parsed.days.map((d) => d.tag)).not.toContain('CD');
    expect(parsed.problems.join(' ')).toMatch(/does not read/);
  });

  it('survives field comments carrying trailing commentary', () => {
    // One real file annotates wind speed with a sentence. Everything from the
    // first brace on is discarded, so the field still matches.
    const parsed = parseDdy(FIXTURE, 'IP');
    expect(parsed.days).toHaveLength(4);
  });
});

describe('switching unit systems', () => {
  it('rebuilds each state rather than relabelling it', () => {
    const ip = parseDdy(FIXTURE, 'IP');
    const si = convertDesignDays(ip, 'SI');
    const backAgain = convertDesignDays(si, 'IP');

    const cool = si.days.find((d) => d.tag === 'CD')!;
    expect(cool.state.tdb).toBeCloseTo(32.2, 1);
    // Humidity ratio is dimensionless and must survive untouched.
    expect(cool.state.w).toBeCloseTo(ip.days.find((d) => d.tag === 'CD')!.state.w, 9);
    expect(backAgain.days.find((d) => d.tag === 'CD')!.state.tdb).toBeCloseTo(89.96, 1);
  });

  it('parses natively in SI too', () => {
    const si = parseDdy(FIXTURE, 'SI');
    expect(si.days.find((d) => d.tag === 'HD')!.state.tdb).toBeCloseTo(-13.1, 6);
  });
});

/**
 * A design day copied verbatim from a real Climate.OneBuilding download.
 *
 * Generated fixtures test the parser against the author's understanding of the
 * format. This tests it against the format. The two differ in exactly the place
 * that matters here: a dew-point condition names its field `Dewpoint at Maximum
 * Dry-Bulb`, not `Wetbulb at ...`.
 *
 * The header comment carries ASHRAE's own humidity ratio for the condition,
 * which makes it a published cross-check on the psychrometry rather than only
 * on the parsing.
 */
const VERBATIM_DEHUMIDIFICATION = `! Boston-Logan.Intl.AP_MA_USA Annual Cooling (DP=>MDB) .4%, MDB=27.1C DP=22.6C HR=0.0174
 SizingPeriod:DesignDay,
  Boston-Logan.Intl.AP Ann Clg .4% Condns DP=>MDB,     !- Name
          7,      !- Month
         21,      !- Day of Month
  SummerDesignDay,!- Day Type
       27.1,      !- Maximum Dry-Bulb Temperature {C}
        8.0,      !- Daily Dry-Bulb Temperature Range {C}
 DefaultMultipliers, !- Dry-Bulb Temperature Range Modifier Type
           ,      !- Dry-Bulb Temperature Range Modifier Day Schedule Name
    Dewpoint,     !- Humidity Condition Type
       22.6,      !- Dewpoint at Maximum Dry-Bulb {C}
           ,      !- Humidity Indicating Day Schedule Name
           ,      !- Humidity Ratio at Maximum Dry-Bulb {kgWater/kgDryAir}
           ,      !- Enthalpy at Maximum Dry-Bulb {J/kg}
           ,      !- Daily Wet-Bulb Temperature Range {deltaC}
    101281.,      !- Barometric Pressure {Pa}
        5.9,      !- Wind Speed {m/s} design conditions vs. traditional 3.35 m/s (7mph)
        240,      !- Wind Direction {Degrees; N=0, S=180}
         No,      !- Rain {Yes/No}
         No,      !- Snow on ground {Yes/No}
         No,      !- Daylight Savings Time Indicator
   ASHRAETau2017, !- Solar Model Indicator
           ,      !- Beam Solar Day Schedule Name
           ,      !- Diffuse Solar Day Schedule Name
      0.463,      !- ASHRAE Clear Sky Optical Depth for Beam Irradiance (taub)
      2.248;      !- ASHRAE Clear Sky Optical Depth for Diffuse Irradiance (taud)
`;

describe('a real dew-point design day', () => {
  const parsed = parseDdy(VERBATIM_DEHUMIDIFICATION, 'SI');
  const day = parsed.days.find((entry) => entry.tag === 'DD');

  it('is found, under the field name a generator actually writes', () => {
    expect(day, parsed.problems.join(' ')).toBeDefined();
    expect(day!.humidityBasis).toBe('Dew point');
  });

  it('reads the stated dry bulb and dew point', () => {
    expect(day!.state.tdb).toBeCloseTo(27.1, 6);
    expect(day!.state.tdp).toBeCloseTo(22.6, 1);
  });

  it('derives close to the humidity ratio ASHRAE publishes for it', () => {
    // The header states HR=0.0174 at MDB=27.1C, DP=22.6C, 101281 Pa. The
    // derivation from the *stated* dew point gives 0.01731 — half a percent
    // low, and the difference is real rather than an error. See below.
    expect(day!.state.w).toBeGreaterThan(0.0174 * 0.99);
    expect(day!.state.w).toBeLessThan(0.0174 * 1.01);
  });

  it('differs from the published figure only by the file’s own rounding', () => {
    // Worth demonstrating rather than asserting, because someone will compare
    // the panel against the header comment and want to know which is wrong.
    //
    // Neither is. The file states the dew point to one decimal but computed its
    // humidity ratio from the unrounded value: 0.0174 corresponds to about
    // 22.69 °C, which rounds to the 22.6 printed. Solving from 22.6 and from
    // 22.7 brackets the published number, which is what "rounding" means here.
    const atStated = fromTdbTdp(27.1, 22.6, 101281, 'SI').w;
    const atNextTenth = fromTdbTdp(27.1, 22.7, 101281, 'SI').w;
    expect(atStated).toBeLessThan(0.0174);
    expect(atNextTenth).toBeGreaterThan(0.0174);

    // And it is not the pressure: across every plausible station value the
    // humidity ratio moves by a hundredth of what the gap is.
    const atSeaLevel = fromTdbTdp(27.1, 22.6, 101325, 'SI').w;
    expect(Math.abs(atSeaLevel - atStated)).toBeLessThan(0.00002);
  });

  it('derives a wet bulb, which the file never states', () => {
    // The whole point of solving rather than reading: the file gives dry bulb
    // and dew point, and the panel and the chart both need a wet bulb.
    expect(day!.state.twb).toBeGreaterThan(day!.state.tdp);
    expect(day!.state.twb).toBeLessThan(day!.state.tdb);
    expect(day!.state.twb).toBeCloseTo(23.9, 0);
  });

  it('is more humid than it is hot — which is why it is published', () => {
    expect(day!.state.rh).toBeGreaterThan(0.7);
  });
});
