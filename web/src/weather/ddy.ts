/**
 * Design-day files (`.ddy`).
 *
 * A Climate.OneBuilding download contains a `.ddy` beside the `.epw`, and it is
 * the more consequential of the two for sizing work. The EPW is a *typical*
 * year — what the weather usually does. The DDY carries the ASHRAE design
 * conditions: the rare hours plant is actually sized against. An engineer who
 * has loaded the weather file already has these numbers on disk; surfacing them
 * saves a trip to the Handbook and removes a transcription step.
 *
 * ## Format
 *
 * EnergyPlus IDF. Objects are `Type, value, value, …;` and each value carries a
 * `!- Field Name` comment. Full-line `!` comments sit between objects and are
 * where the human-readable summaries live.
 *
 * Fields are read **by their comment**, not by position. Position is how this
 * is usually parsed and it is brittle: EnergyPlus has changed the object's
 * field list across versions, and the comments are what actually identify a
 * value. A file whose comments are missing is reported rather than guessed at.
 *
 * ## Which days
 *
 * A DDY typically holds a dozen or more design days — wind, monthly cooling,
 * several percentiles. Four are extracted, being the ones an air-side designer
 * reaches for:
 *
 * | Tag | Condition | ASHRAE name |
 * |---|---|---|
 * | HD | Heating | Annual Heating 99.6%, DB |
 * | CD | Cooling | Annual Cooling 0.4%, DB with mean coincident WB |
 * | DD | Dehumidification | Annual Cooling 0.4%, DP with mean coincident DB |
 * | ED | Enthalpy | Annual Cooling 0.4%, Enthalpy with mean coincident DB |
 *
 * DD and ED matter because peak dry bulb and peak moisture do not coincide. A
 * coil selected only against CD can be undersized for latent load; that is the
 * whole reason ASHRAE publishes the other two.
 */
import { fromTdbTwb, fromTdbTdp, fromTdbW, fromTdbEnthalpy, type MoistAirState } from '../psych/state.js';
import { celsiusToFahrenheit, type UnitSystem } from '../psych/units.js';

export type DesignDayKind = 'heating' | 'cooling' | 'dehumidification' | 'enthalpy';

export interface DesignDay {
  readonly kind: DesignDayKind;
  /** Two-letter tag, matching the chart. */
  readonly tag: 'HD' | 'CD' | 'DD' | 'ED';
  /** What to call it in the interface. */
  readonly label: string;
  /** The object's own name, kept so a number can be traced to its source. */
  readonly name: string;
  readonly month: number;
  readonly day: number;
  /** The design condition, in the application's unit system. */
  readonly state: MoistAirState;
  /** Site pressure the file specifies, in the application's units. */
  readonly pressure: number;
  /** How the file specified humidity — worth showing, because it varies. */
  readonly humidityBasis: string;
}

export interface DesignDayFile {
  readonly days: readonly DesignDay[];
  readonly problems: readonly string[];
  readonly units: UnitSystem;
}

/**
 * The four conditions, and how to recognise them.
 *
 * Matched against the object name rather than the surrounding comment, because
 * the comment is prose and the name is generated. The patterns are deliberately
 * specific: a DDY also contains `Ann Htg Wind 99.6% Condns WS=>MCDB`, which a
 * looser match on "Htg 99.6%" would pick up as the heating design day and
 * quietly report a wind speed as a temperature.
 */
const WANTED: {
  kind: DesignDayKind;
  tag: DesignDay['tag'];
  label: string;
  pattern: RegExp;
}[] = [
  {
    kind: 'heating',
    tag: 'HD',
    label: 'Heating design',
    pattern: /htg\s+99\.6%\s+condns\s+db\b/,
  },
  {
    kind: 'cooling',
    tag: 'CD',
    label: 'Cooling design',
    pattern: /clg\s+\.4%\s+condns\s+db=>mwb\b/,
  },
  {
    kind: 'dehumidification',
    tag: 'DD',
    label: 'Dehumidification design',
    pattern: /clg\s+\.4%\s+condns\s+dp=>mdb\b/,
  },
  {
    kind: 'enthalpy',
    tag: 'ED',
    label: 'Enthalpy design',
    pattern: /clg\s+\.4%\s+condns\s+enth=>mdb\b/,
  },
];

/** Order the four are listed and drawn in: coldest first. */
export const DESIGN_DAY_ORDER: readonly DesignDayKind[] = [
  'heating',
  'cooling',
  'dehumidification',
  'enthalpy',
];

/**
 * Normalise a field-comment so it can be matched.
 *
 * Comments carry units and sometimes commentary — one real file annotates wind
 * speed with `{m/s} design conditions vs. traditional 6.71 m/s (15 mph)`. Only
 * the leading name is meaningful, so everything from the first brace onward is
 * discarded.
 */
function normaliseField(comment: string): string {
  return comment.split('{')[0]!.trim().toLowerCase();
}

/** Split one object body into a field-name → value map. */
function fieldsOf(body: string): Map<string, string> {
  const fields = new Map<string, string>();

  for (const line of body.split(/\r?\n/)) {
    const marker = line.indexOf('!-');
    if (marker < 0) continue;
    const value = line.slice(0, marker).replace(/[,;]\s*$/, '').trim();
    const name = normaliseField(line.slice(marker + 2));
    if (name && !fields.has(name)) fields.set(name, value);
  }

  return fields;
}

/**
 * First field whose comment matches any of the given names.
 *
 * Several are accepted because one field genuinely has several names. The
 * EnergyPlus dictionary calls it `Wetbulb or DewPoint at Maximum Dry-Bulb`, and
 * generators write whichever half applies — `Wetbulb at Maximum Dry-Bulb` for a
 * wet-bulb condition, `Dewpoint at Maximum Dry-Bulb` for a dew-point one.
 * Reading only the first name loses every dehumidification day, which is the
 * one condition this feature exists to surface.
 */
function read(fields: Map<string, string>, ...names: string[]): string | undefined {
  for (const name of names) {
    const wanted = name.toLowerCase();
    for (const [key, value] of fields) {
      if (key === wanted || key.startsWith(wanted)) return value;
    }
  }
  return undefined;
}

function readNumber(fields: Map<string, string>, ...names: string[]): number | undefined {
  const raw = read(fields, ...names);
  if (raw === undefined || raw === '') return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The humidity value field, under any of the names a generator gives it.
 *
 * Order matters only in that all three refer to the same field; whichever the
 * file used is the one that will be present.
 */
const HUMIDITY_FIELD = [
  'dewpoint at maximum dry-bulb',
  'wetbulb at maximum dry-bulb',
  'wetbulb or dewpoint at maximum dry-bulb',
];

/**
 * Build the design condition.
 *
 * The humidity field is *reused*: `Wetbulb at Maximum Dry-Bulb` holds a wet
 * bulb or a dew point depending on the condition type, and the enthalpy and
 * humidity-ratio cases put their value in their own fields. Reading the type
 * first is the only way to know what the number means — and the dehumidification
 * day is precisely the one where it is a dew point, so getting this wrong would
 * misplot exactly the condition that was worth surfacing.
 */
function conditionFrom(
  fields: Map<string, string>,
  tdbC: number,
  pressurePa: number,
  units: UnitSystem,
): { state: MoistAirState; basis: string } | string {
  const type = (read(fields, 'humidity condition type') ?? '').toLowerCase();

  // Temperatures convert; humidity ratio is dimensionless and carries across
  // untouched. Enthalpy does *not* convert — the IP and SI datums differ — so
  // the enthalpy case is solved in SI and handed on as a humidity ratio.
  const tdb = units === 'IP' ? celsiusToFahrenheit(tdbC) : tdbC;
  const pressure = units === 'IP' ? pressurePa / 6894.757 : pressurePa;

  const asDisplay = (celsius: number): number =>
    units === 'IP' ? celsiusToFahrenheit(celsius) : celsius;

  try {
    if (type.startsWith('wetbulb')) {
      const wb = readNumber(fields, ...HUMIDITY_FIELD);
      if (wb === undefined) return 'has a wet-bulb condition with no wet-bulb value';
      return { state: fromTdbTwb(tdb, asDisplay(wb), pressure, units), basis: 'Wet bulb' };
    }
    if (type.startsWith('dewpoint')) {
      const dp = readNumber(fields, ...HUMIDITY_FIELD);
      if (dp === undefined) return 'has a dew-point condition with no dew-point value';
      // The file gives dry bulb and dew point; wet bulb is solved from them
      // through the humidity ratio, so the point plots where it belongs and the
      // panel can show a wet bulb the file never stated.
      return { state: fromTdbTdp(tdb, asDisplay(dp), pressure, units), basis: 'Dew point' };
    }
    if (type.startsWith('enthalpy')) {
      const joules = readNumber(fields, 'enthalpy at maximum dry-bulb');
      if (joules === undefined) return 'has an enthalpy condition with no enthalpy value';
      // Solved in SI at SI pressure, then carried across as humidity ratio.
      const inSI = fromTdbEnthalpy(tdbC, joules, pressurePa, 'SI');
      return { state: fromTdbW(tdb, inSI.w, pressure, units), basis: 'Enthalpy' };
    }
    if (type.startsWith('humidityratio')) {
      const w = readNumber(fields, 'humidity ratio at maximum dry-bulb');
      if (w === undefined) return 'has a humidity-ratio condition with no value';
      return { state: fromTdbW(tdb, w, pressure, units), basis: 'Humidity ratio' };
    }
  } catch (error) {
    return `could not be solved — ${error instanceof Error ? error.message : 'unknown error'}`;
  }

  return `uses humidity condition type "${type || 'none'}", which this tool does not read`;
}

/**
 * Parse a `.ddy`, pulling out the four design conditions.
 *
 * Never throws. A file missing some of the four returns the ones it has, with
 * the absences noted — partial design data is still worth showing, and the
 * alternative is a weather import that fails because of a secondary file.
 */
export function parseDdy(text: string, units: UnitSystem): DesignDayFile {
  const problems: string[] = [];
  const days: DesignDay[] = [];

  // From after the object keyword to its terminating semicolon. Values in a
  // design-day object never contain one.
  const objects = [...text.matchAll(/SizingPeriod:DesignDay\s*,([\s\S]*?);/gi)];

  if (objects.length === 0) {
    return {
      days: [],
      problems: ['No design days were found in this file.'],
      units,
    };
  }

  for (const { kind, tag, label, pattern } of WANTED) {
    let found = false;

    for (const object of objects) {
      const fields = fieldsOf(object[1]!);
      const name = read(fields, 'name') ?? '';
      if (!pattern.test(name.toLowerCase())) continue;

      found = true;
      const tdbC = readNumber(fields, 'maximum dry-bulb temperature');
      const pressurePa = readNumber(fields, 'barometric pressure');

      if (tdbC === undefined) {
        problems.push(`The ${label.toLowerCase()} day has no dry-bulb temperature.`);
        break;
      }
      if (pressurePa === undefined) {
        problems.push(`The ${label.toLowerCase()} day has no barometric pressure.`);
        break;
      }

      const condition = conditionFrom(fields, tdbC, pressurePa, units);
      if (typeof condition === 'string') {
        problems.push(`The ${label.toLowerCase()} day ${condition}.`);
        break;
      }

      days.push({
        kind,
        tag,
        label,
        name,
        month: readNumber(fields, 'month') ?? 0,
        day: readNumber(fields, 'day of month') ?? 0,
        state: condition.state,
        pressure: units === 'IP' ? pressurePa / 6894.757 : pressurePa,
        humidityBasis: condition.basis,
      });
      break;
    }

    if (!found) {
      problems.push(`This file has no ${label.toLowerCase()} condition (ASHRAE annual, 0.4%/99.6%).`);
    }
  }

  return { days, problems, units };
}

/**
 * Re-express design days in another unit system.
 *
 * Same reasoning as the hourly data: states are held in display units so the
 * rest of the application can treat them like any other value, which means a
 * unit switch has to convert them rather than relabel them. Humidity ratio is
 * dimensionless and carries across, so each state is rebuilt from dry bulb and
 * W rather than converted property by property — enthalpy in particular does
 * not survive a naive conversion.
 */
export function convertDesignDays(file: DesignDayFile, units: UnitSystem): DesignDayFile {
  if (file.units === units) return file;

  const temperature = (value: number): number =>
    units === 'IP' ? celsiusToFahrenheit(value) : (value - 32) * (5 / 9);
  const pressure = (value: number): number =>
    units === 'IP' ? value / 6894.757 : value * 6894.757;

  return {
    ...file,
    units,
    days: file.days.map((day) => ({
      ...day,
      pressure: pressure(day.pressure),
      state: fromTdbW(temperature(day.state.tdb), day.state.w, pressure(day.state.pressure), units),
    })),
  };
}
