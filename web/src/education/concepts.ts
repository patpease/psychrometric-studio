/**
 * The chart's own vocabulary — one entry per term.
 *
 * This registry does double duty, and deliberately so. `summary` is the
 * tooltip; `text` and `practice` are the panel. Splitting them into a tooltip
 * table and a content file would guarantee that the two definitions of "bypass
 * factor" drift apart, and the one a user sees would depend on where they
 * happened to hover.
 *
 * `summary` is therefore held to a hard constraint: **one sentence, no more**,
 * short enough to read without breaking concentration. Everything else belongs
 * in `text`.
 */

export interface ConceptEntry {
  readonly id: string;
  readonly title: string;
  /** One sentence. Used as the tooltip wherever the term appears. */
  readonly summary: string;
  /** Icon file name, where a process icon fits the idea. */
  readonly icon?: string;
  /** The fuller explanation, for the panel. */
  readonly text?: string;
  /** What it means when you are actually designing something. */
  readonly practice?: string;
  readonly seeAlso?: readonly string[];
}

const entries: ConceptEntry[] = [
  /* ---------------------------------------------------------------- axes -- */
  {
    id: 'dry-bulb',
    title: 'Dry-bulb temperature',
    summary: 'Air temperature as an ordinary thermometer reads it, and the chart’s horizontal axis.',
    icon: 'process-sensible-heating',
    text:
      'The temperature of the air itself, unaffected by its moisture content. ' +
      'Every vertical line on the chart is a constant dry-bulb line, which is ' +
      'why a purely sensible process — heating, fan heat, a sensible wheel — ' +
      'moves horizontally and nothing else changes.',
    seeAlso: ['wet-bulb', 'dew-point', 'sensible-heat'],
  },
  {
    id: 'humidity-ratio',
    title: 'Humidity ratio',
    summary: 'The mass of water vapour carried per unit mass of dry air — the chart’s vertical axis.',
    icon: 'process-humidification',
    text:
      'Written W, in lb of water per lb of dry air, or kg per kg. It is an ' +
      'absolute measure: unlike relative humidity it does not change when the ' +
      'air is heated or cooled, only when moisture is genuinely added or ' +
      'removed. That is what makes it the right vertical axis — a horizontal ' +
      'line on this chart means "no moisture crossed a boundary".',
    practice:
      'Latent loads are moisture flows, so they are naturally expressed as a ' +
      'change in W times the dry-air mass flow. Working in W rather than RH is ' +
      'what keeps a mixing or coil calculation honest.',
    seeAlso: ['relative-humidity', 'latent-heat', 'dew-point'],
  },
  {
    id: 'relative-humidity',
    title: 'Relative humidity',
    summary: 'How much moisture the air holds as a fraction of the most it could hold at that temperature.',
    icon: 'process-humidification',
    text:
      'The curved lines sweeping up from the left. RH depends on temperature as ' +
      'much as on moisture: heat air without adding a drop of water and its RH ' +
      'falls, because warmer air could hold more. The saturation curve is the ' +
      '100% RH line.',
    practice:
      'RH is what occupants and materials respond to, so it is the right thing ' +
      'to specify — and the wrong thing to do arithmetic with. Convert to ' +
      'humidity ratio before adding or averaging anything.',
    seeAlso: ['humidity-ratio', 'saturation-curve', 'comfort-zone'],
  },
  {
    id: 'wet-bulb',
    title: 'Wet-bulb temperature',
    summary: 'What a thermometer reads with a wetted wick in moving air — the lowest temperature evaporation alone can reach.',
    icon: 'process-adiabatic',
    text:
      'Water evaporating from the wick draws heat from the air, and the wet-bulb ' +
      'temperature is where that cooling comes into balance. The near-straight ' +
      'lines sloping down to the right are constant wet-bulb lines, and they run ' +
      'almost — but not exactly — parallel to constant-enthalpy lines.',
    practice:
      'The entering wet bulb is a hard floor for every evaporative process. It ' +
      'is also what a cooling tower is rated against, which is why tower ' +
      'selection is a climate question first.',
    seeAlso: ['adiabatic-saturation', 'enthalpy', 'evaporative-direct'],
  },
  {
    id: 'dew-point',
    title: 'Dew-point temperature',
    summary: 'The temperature at which air, cooled at constant moisture content, begins to condense.',
    icon: 'process-cooling-dehumidification',
    text:
      'Move horizontally left from any state until you meet the saturation ' +
      'curve; that temperature is the dew point. Because the move is horizontal, ' +
      'dew point depends only on humidity ratio — two states at the same W have ' +
      'the same dew point however different their temperatures.',
    practice:
      'A cooling coil dehumidifies only if its surface is below the entering dew ' +
      'point. Dew point is also the number to check against any cold surface in ' +
      'the building: below it, you get condensation.',
    seeAlso: ['humidity-ratio', 'apparatus-dew-point', 'saturation-curve'],
  },
  {
    id: 'enthalpy',
    title: 'Enthalpy',
    summary: 'The total heat content of the air per unit mass of dry air, sensible and latent together.',
    icon: 'process-cooling-dehumidification',
    text:
      'Enthalpy counts the heat in the air and the heat in the water vapour it ' +
      'carries. Because it is a total, a duty is simply mass flow times the ' +
      'change in enthalpy — which is why the whole chain in this tool balances ' +
      'on enthalpy rather than on temperature.',
    practice:
      'The datum differs between unit systems: IP measures from 0 °F, SI from ' +
      '0 °C. Enthalpies are therefore not convertible by a simple factor, and ' +
      'only *differences* mean the same thing in both.',
    seeAlso: ['wet-bulb', 'sensible-heat', 'latent-heat'],
  },
  {
    id: 'specific-volume',
    title: 'Specific volume',
    summary: 'The volume occupied per unit mass of dry air — the bridge between CFM and lb/h.',
    text:
      'Steep lines running bottom-left to top-right. Air expands as it warms and ' +
      'as it takes on moisture, so a fixed volumetric flow carries less mass at ' +
      'higher temperature.',
    practice:
      'This is why fans are specified in CFM but loads are calculated on mass. ' +
      'Using a sea-level density at 5,000 ft overstates the mass flow by about ' +
      '17%, and every duty calculated from it by the same amount.',
    seeAlso: ['barometric-pressure', 'humidity-ratio'],
  },
  {
    id: 'saturation-curve',
    title: 'Saturation curve',
    summary: 'The 100% relative humidity boundary — the chart’s left-hand edge, and the limit of real moist air.',
    text:
      'Air cannot hold more vapour than the saturation curve allows at a given ' +
      'temperature and pressure. There is no region above and to the left of it: ' +
      'a state plotted there is fog, not moist air, and this tool refuses to ' +
      'report properties for it rather than extrapolating.',
    seeAlso: ['dew-point', 'relative-humidity', 'apparatus-dew-point'],
  },
  {
    id: 'state-point',
    title: 'State point',
    summary: 'One condition of moist air — fix any two independent properties and the other seven follow.',
    icon: 'state-point',
    text:
      'Dry bulb with RH, dry bulb with wet bulb, dew point with enthalpy: any ' +
      'independent pair locates the point, and everything else is then ' +
      'determined. This is the whole reason the chart works as a graphical ' +
      'calculator.',
    practice:
      'Two properties that are *not* independent — dew point and humidity ratio, ' +
      'say — fix nothing. If a stage will not solve, an unwitting repeat of the ' +
      'same property is the first thing to look for.',
    seeAlso: ['dry-bulb', 'humidity-ratio', 'barometric-pressure'],
  },

  /* -------------------------------------------------------- constructions -- */
  {
    id: 'sensible-heat',
    title: 'Sensible heat',
    summary: 'Heat that changes the air’s temperature without changing how much water it carries.',
    icon: 'process-sensible-heating',
    text:
      'A purely sensible process is horizontal on the chart. Heating coils, fans, ' +
      'sensible wheels and plate exchangers all move air this way, and the ' +
      'humidity ratio holding constant is the test that they were modelled right.',
    seeAlso: ['latent-heat', 'shr', 'dry-bulb'],
  },
  {
    id: 'latent-heat',
    title: 'Latent heat',
    summary: 'Heat associated with adding or removing moisture, at no change in temperature.',
    icon: 'process-humidification',
    text:
      'A purely latent process is vertical. In practice almost nothing is purely ' +
      'latent — a cooling coil does both at once, and a steam humidifier adds a ' +
      'little sensible heat with the moisture.',
    practice:
      'People, infiltration, and outdoor air are the usual latent loads. They are ' +
      'also the ones most often left out, and their absence shows up as a space ' +
      'that holds temperature but not humidity.',
    seeAlso: ['sensible-heat', 'shr', 'humidity-ratio'],
  },
  {
    id: 'shr',
    title: 'Sensible heat ratio',
    summary: 'The fraction of a total load that is sensible — and therefore the slope of the process line.',
    icon: 'process-cooling-dehumidification',
    text:
      'SHR = sensible ÷ total. It is a ratio of loads, but on the chart it is a ' +
      'direction: SHR of 1.0 is horizontal, and lower values tilt the line ' +
      'steeper as the latent share grows. A room’s SHR is set by its loads, not ' +
      'chosen — the designer’s job is to find a supply condition that lies on it.',
    practice:
      'A coil’s SHR and a room’s SHR are different numbers doing different jobs. ' +
      'Matching a coil selection to the room SHR is the central move in sizing ' +
      'an air system.',
    seeAlso: ['protractor', 'room', 'cooling'],
  },
  {
    id: 'protractor',
    title: 'SHR protractor',
    summary: 'The corner scale that converts a sensible heat ratio into a direction on the chart.',
    text:
      'Line the protractor’s SHR value up with its centre, and the direction you ' +
      'read off is the slope of a process line at that ratio. Transfer it through ' +
      'the state point and you have the room load line — this is how it was done ' +
      'before software, and it is still the fastest way to see whether a supply ' +
      'condition can work.',
    seeAlso: ['shr', 'room'],
  },
  {
    id: 'apparatus-dew-point',
    title: 'Apparatus dew point',
    summary: 'The effective coil surface temperature — where the process line, extended, meets the saturation curve.',
    icon: 'process-cooling-dehumidification',
    text:
      'A coil does not have one surface temperature, but it behaves as though it ' +
      'did. Extend the line from entering to leaving air until it strikes the ' +
      'saturation curve, and that intersection is the apparatus dew point: the ' +
      'condition air would reach if it all made perfect contact with the fins.',
    practice:
      'Chilled-water coils commonly land at an ADP of 48–52 °F (9–11 °C). If the ' +
      'extended line never reaches saturation, the process is not a ' +
      'dehumidifying coil at all — and the tool will say so rather than inventing ' +
      'a number.',
    seeAlso: ['bypass-factor', 'cooling', 'saturation-curve'],
  },
  {
    id: 'bypass-factor',
    title: 'Bypass factor',
    summary: 'The fraction of air that leaves a coil as though it had never touched it.',
    text:
      'Real coils are mostly open space. Some air makes full contact with the ' +
      'fins and leaves at the apparatus dew point; the rest slips through ' +
      'unchanged. The leaving condition is the mixture of those two, and the ' +
      'bypass factor is how much of it is the unchanged part. Contact factor is ' +
      'one minus it.',
    practice:
      'Roughly 0.15–0.25 for a four-row coil, 0.03–0.08 for eight rows. Deeper ' +
      'coils and lower face velocities lower it; both cost pressure drop, which ' +
      'is the trade being made.',
    seeAlso: ['apparatus-dew-point', 'cooling'],
  },
  {
    id: 'lever-rule',
    title: 'Lever rule',
    summary: 'A mixture of two airstreams lies on the straight line between them, positioned by mass fraction.',
    icon: 'process-mixing',
    text:
      'Mix 25% of stream A with 75% of stream B and the result sits a quarter of ' +
      'the way from B toward A. It works on the chart because both axes are ' +
      'per-unit-mass-of-dry-air quantities, so both average linearly.',
    practice:
      'The fractions are **mass** fractions. Equal volumetric flows at different ' +
      'temperatures are not equal masses, and using CFM directly puts the mix ' +
      'point in the wrong place — always in the direction that flatters the ' +
      'outdoor-air percentage.',
    seeAlso: ['mixing', 'specific-volume'],
  },
  {
    id: 'adiabatic-saturation',
    title: 'Adiabatic saturation',
    summary: 'Evaporating water into air using only the air’s own heat, so it cools as it humidifies.',
    icon: 'process-adiabatic',
    text:
      'No heat crosses the boundary; the sensible heat given up by the air ' +
      'becomes the latent heat of the water it takes on. The state slides down a ' +
      'constant wet-bulb line toward saturation, and the entering wet bulb is the ' +
      'furthest it can possibly go.',
    seeAlso: ['wet-bulb', 'evaporative-direct', 'humidifier-adiabatic'],
  },
  {
    id: 'effectiveness',
    title: 'Effectiveness',
    summary: 'How much of the theoretically available transfer a device actually achieves, as a fraction.',
    icon: 'heat-exchanger',
    text:
      'For heat recovery, effectiveness compares the change achieved to the ' +
      'maximum the two entering conditions allow. It is referenced to the ' +
      '**smaller** of the two mass flows, because that stream limits the ' +
      'transfer — a large exhaust flow cannot heat a small supply flow beyond ' +
      'what the supply can absorb.',
    practice:
      'Sensible and latent effectiveness are separate ratings. A single quoted ' +
      'figure usually means total effectiveness, and applying it to both halves ' +
      'overstates the latent recovery.',
    seeAlso: ['recovery-wheel-enthalpy', 'recovery-plate'],
  },
  {
    id: 'barometric-pressure',
    title: 'Barometric pressure',
    summary: 'The site pressure the whole chart is drawn for — change it and every line moves.',
    text:
      'A psychrometric chart is only valid at one pressure. At altitude the air ' +
      'is thinner, so at a given temperature and humidity ratio the relative ' +
      'humidity, wet bulb, and specific volume are all different from their ' +
      'sea-level values.',
    practice:
      'Denver at 5,280 ft sits near 12.1 psia against 14.696 at sea level. Using ' +
      'a sea-level chart there overstates air mass flow by about 17% and every ' +
      'duty calculated from it by the same margin.',
    seeAlso: ['specific-volume', 'state-point'],
  },

  /* ---------------------------------------------------------- comfort ----- */
  {
    id: 'comfort-zone',
    title: 'Comfort zone',
    summary: 'The region of the chart where ASHRAE 55 predicts at least 80% of occupants will be satisfied.',
    icon: 'thermostat',
    text:
      'The boundary is where PMV reaches ±0.5, solved at each humidity for the ' +
      'clothing, activity, air speed, and mean radiant temperature you set. It ' +
      'is capped above at a humidity ratio of 0.012, and — deliberately — has no ' +
      'lower humidity limit in the 2023 edition.',
    practice:
      'The zone moves with its inputs, sometimes a great deal. A zone drawn for ' +
      '0.5 clo and one for 1.0 clo describe different buildings, so quoting "the ' +
      'comfort zone" without its assumptions says very little.',
    seeAlso: ['pmv', 'clo', 'met', 'adaptive-comfort'],
  },
  {
    id: 'pmv',
    title: 'PMV',
    summary: 'Predicted Mean Vote: where an average group would rate the thermal environment, from −3 cold to +3 hot.',
    text:
      'Fanger’s heat-balance model, taking dry-bulb and mean radiant temperature, ' +
      'humidity, air speed, clothing, and metabolic rate. Zero is neutral, and ' +
      'ASHRAE 55 draws its comfort zone at ±0.5.',
    practice:
      'PMV describes a group, never a person. Individual variation is real and ' +
      'large, which is why even a perfect zero predicts around 5% dissatisfied.',
    seeAlso: ['ppd', 'comfort-zone', 'clo', 'met'],
  },
  {
    id: 'ppd',
    title: 'PPD',
    summary: 'Predicted Percentage Dissatisfied — the share of occupants expected to be uncomfortable.',
    text:
      'A fixed function of PMV, and it never falls below 5%: even a thermally ' +
      'neutral environment leaves some people unhappy. PMV of ±0.5 corresponds ' +
      'to about 10% dissatisfied, which is the basis for the zone boundary.',
    seeAlso: ['pmv', 'comfort-zone'],
  },
  {
    id: 'clo',
    title: 'Clothing insulation (clo)',
    summary: 'The thermal resistance of what occupants are wearing; 1.0 clo is a typical business suit.',
    text:
      'Around 0.5 clo for summer clothing, 1.0 for a winter indoor ensemble. It ' +
      'shifts the comfort zone bodily along the temperature axis — roughly 10 °F ' +
      '(6 K) between those two values.',
    practice:
      'Seasonal clothing is the reason a single year-round setpoint satisfies ' +
      'nobody in either season. Relaxed dress codes are a genuine energy measure.',
    seeAlso: ['comfort-zone', 'pmv'],
  },
  {
    id: 'met',
    title: 'Metabolic rate (met)',
    summary: 'The occupant’s heat production; 1.0 met is seated and at rest.',
    text:
      'Around 1.0–1.2 met for office work, 1.6 for standing and light activity, ' +
      '2.0 and above for walking. Higher activity shifts comfort toward cooler ' +
      'air and raises the latent load at the same time.',
    seeAlso: ['comfort-zone', 'pmv'],
  },
  {
    id: 'adaptive-comfort',
    title: 'Adaptive comfort',
    summary: 'A separate ASHRAE 55 model for naturally conditioned spaces, where acceptable temperature follows the outdoor climate.',
    text:
      'Where occupants control operable windows and there is no mechanical ' +
      'cooling, comfort tracks recent outdoor conditions: t_comf = 0.31·t_pma + ' +
      '17.8 °C, with an 80% acceptability band of ±3.5 K and a 90% band of ±2.5 K.',
    practice:
      'It applies only where its preconditions hold. Using it to justify a warmer ' +
      'setpoint in a sealed, mechanically cooled building is outside the model.',
    seeAlso: ['prevailing-mean', 'comfort-zone'],
  },
  {
    id: 'prevailing-mean',
    title: 'Prevailing mean outdoor temperature',
    summary: 'A weighted running mean of recent daily outdoor temperatures — the adaptive model’s only climate input.',
    text:
      'Typically the mean of the 7 to 30 days preceding the day being assessed, ' +
      'weighted so that recent days count for more. It stands in for how far ' +
      'occupants have acclimatised.',
    seeAlso: ['adaptive-comfort', 'weather-overlay'],
  },

  /* ---------------------------------------------------------- weather ----- */
  {
    id: 'weather-overlay',
    title: 'Weather overlay',
    summary: 'A whole year of hourly outdoor conditions plotted on the chart, as points or as hours-per-cell.',
    text:
      'Eight thousand seven hundred and sixty points show where a climate lives. ' +
      'As a scatter they overlap and hide their own density, so the binned view ' +
      'counts hours per cell instead — the difference between two hours a year ' +
      'and two hundred becomes visible.',
    practice:
      'Counting hours against the comfort zone turns the chart into a screening ' +
      'tool: it says what the outdoor climate does, which is the first question ' +
      'before asking what the building must do about it.',
    seeAlso: ['epw', 'comfort-zone'],
  },
  {
    id: 'epw',
    title: 'EPW weather file',
    summary: 'The EnergyPlus Weather format: 8,760 hourly records of a typical year, always in SI.',
    text:
      'Eight header lines then one row per hour, carrying dry bulb, dew point, ' +
      'relative humidity, station pressure, wind, and solar. This tool reads it ' +
      'entirely in your browser — nothing is uploaded.',
    practice:
      'Missing values are stored as *values*, not blanks: 99.9 °C, 999% RH. Any ' +
      'tool that plots them without filtering will show points far off the chart ' +
      'and statistics quietly skewed.',
    seeAlso: ['weather-overlay'],
  },
];

export const CONCEPTS: Readonly<Record<string, ConceptEntry>> = Object.freeze(
  Object.fromEntries(entries.map((entry) => [entry.id, entry])),
);

export const CONCEPT_ORDER: readonly string[] = Object.freeze(entries.map((entry) => entry.id));

/**
 * Concepts grouped as the panel presents them when no component is selected.
 *
 * The grouping is the reading order someone new to the chart needs: what the
 * axes are, then what you can construct on them, then the two overlays.
 */
export const CONCEPT_GROUPS: readonly { label: string; ids: readonly string[] }[] = Object.freeze([
  {
    label: 'Reading the chart',
    ids: [
      'state-point',
      'dry-bulb',
      'humidity-ratio',
      'relative-humidity',
      'wet-bulb',
      'dew-point',
      'enthalpy',
      'specific-volume',
      'saturation-curve',
    ],
  },
  {
    label: 'Constructions',
    ids: [
      'sensible-heat',
      'latent-heat',
      'shr',
      'protractor',
      'apparatus-dew-point',
      'bypass-factor',
      'lever-rule',
      'adiabatic-saturation',
      'effectiveness',
      'barometric-pressure',
    ],
  },
  {
    label: 'Comfort',
    ids: ['comfort-zone', 'pmv', 'ppd', 'clo', 'met', 'adaptive-comfort', 'prevailing-mean'],
  },
  { label: 'Weather', ids: ['weather-overlay', 'epw'] },
]);

/** The one-line definition for a term, for tooltips. */
export function tooltipFor(id: string): string | undefined {
  return CONCEPTS[id]?.summary;
}
