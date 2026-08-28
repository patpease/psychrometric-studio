/**
 * Design-day parsing.
 *
 * The fixture below is shaped like a real Climate.OneBuilding `.ddy`: the four
 * conditions this tool wants, mixed in with the ones it must ignore. Those
 * decoys are the point — a DDY holds a dozen or more design days, and several
 * have names close enough to the wanted ones that a loose match picks up a wind
 * speed and reports it as a temperature.
 */
import { describe, it, expect } from 'vitest';
import { parseDdy, convertDesignDays } from '../src/weather/ddy.js';
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
      ${humidityValue},      !- Wetbulb at Maximum Dry-Bulb {C}
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
