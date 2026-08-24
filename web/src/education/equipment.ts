/**
 * What each piece of equipment does, and what to check about it.
 *
 * Eleven of these are ported from bh-psych's `education.py`, lightly edited.
 * Six are new — the sensible and enthalpy wheels, the plate exchanger, direct
 * and indirect evaporative cooling, and the desiccant wheel — because Phase 4
 * added the equipment and the original never modelled it.
 *
 * The writing has one rule: **say what a reviewer would say**. Not what a
 * textbook would say, and not what a manufacturer would say. The `check` field
 * is the load-bearing one; the rest is context for reading it.
 */
import type { StageType } from '../types/project.js';
import type { EducationEntry } from './types.js';
import { STAGE_ICONS } from '../icons/map.js';
import {
  adiabaticCheck,
  coolingCoilCheck,
  desiccantCheck,
  enthalpyWheelCheck,
  fanCheck,
  heatingCoilCheck,
  indirectEvaporativeCheck,
  mixingCheck,
  plateCheck,
  roomCheck,
  runaroundCheck,
  sensibleWheelCheck,
  steamHumidifierCheck,
  wraparoundReheatCheck,
} from './checks.js';

const icon = (type: StageType): string => STAGE_ICONS[type];

export const EQUIPMENT: Readonly<Record<StageType, EducationEntry>> = Object.freeze({
  source: {
    id: 'source',
    title: 'Entering air',
    kind: 'Defined state',
    icon: icon('source'),
    moves: [
      { property: 'tdb', direction: 'input' },
      { property: 'rh', direction: 'input' },
    ],
    text:
      'The starting point of the airstream — outdoor air, return air, or any ' +
      'measured condition. Everything downstream is solved from here, so the ' +
      'quality of this input sets the quality of the whole analysis. Two ' +
      'properties fix the state; the tool derives the other seven.',
    check:
      'Use coincident design conditions — ASHRAE 0.4% dry bulb with its mean ' +
      'coincident wet bulb — not the peak dry bulb paired with the peak wet ' +
      'bulb. That pairing almost never occurs and it oversizes coils.',
    typical: [
      { label: 'Cooling design', value: '0.4% DB / MCWB' },
      { label: 'Dehumidification design', value: '0.4% DP / MCDB' },
      { label: 'Heating design', value: '99.6% DB' },
    ],
    seeAlso: ['state-point', 'weather-overlay'],
  },

  mixing: {
    id: 'mixing',
    title: 'Mixing box',
    kind: 'Adiabatic mixing',
    icon: icon('mixing'),
    moves: [
      { property: 'tdb', direction: 'between' },
      { property: 'w', direction: 'between' },
      { property: 'h', direction: 'between' },
    ],
    text:
      'Two airstreams combine with no heat added or removed. The mixed state ' +
      'always lies on the straight line between the two entering states, ' +
      'positioned by dry-air mass fraction — the lever rule. Mix 25% outdoor ' +
      'air and the mixed point sits a quarter of the way along that line, ' +
      'measured from the return end.',
    check:
      'Verify the mixed point sits on the line between the two entering points ' +
      'at the correct mass fraction. If it does not, the flow measurements or ' +
      'the entering states are inconsistent. Note that the lever rule works on ' +
      'mass, not volume — equal CFM of hot and cool air are not equal masses.',
    rule: mixingCheck,
    typical: [
      { label: 'Minimum outdoor air', value: 'per ASHRAE 62.1 ventilation rate' },
      { label: 'Economiser', value: 'up to 100% outdoor air' },
    ],
    seeAlso: ['lever-rule', 'enthalpy'],
  },

  cooling: {
    id: 'cooling',
    title: 'Cooling coil',
    kind: 'Sensible + latent cooling',
    icon: icon('cooling'),
    moves: [
      { property: 'tdb', direction: 'down' },
      { property: 'w', direction: 'conditional', qualifier: 'down, if the surface is below the entering dew point' },
      { property: 'h', direction: 'down' },
      { property: 'rh', direction: 'up' },
    ],
    text:
      'Air passes over a coil whose surface sits below the entering dew point, ' +
      'so moisture condenses while the air cools. The process line points ' +
      'toward the apparatus dew point on the saturation curve, and the bypass ' +
      'factor sets how far along it the air actually lands. Air that touched ' +
      'the fins leaves at the ADP; air that slipped between them leaves ' +
      'unchanged, and the leaving condition is the mixture of the two.',
    check:
      'Off-coil air typically leaves at 90–95% RH. A leaving condition at 70% ' +
      'usually means the coil selection, the SHR, or the bypass factor deserves ' +
      'a second look. Confirm the coil surface is actually below the entering ' +
      'dew point before claiming any latent capacity at all.',
    rule: coolingCoilCheck,
    typical: [
      { label: 'Bypass factor, 4-row', value: '0.15 – 0.25' },
      { label: 'Bypass factor, 8-row', value: '0.03 – 0.08' },
      { label: 'Face velocity', value: '400 – 550 fpm (2.0 – 2.8 m/s)' },
      { label: 'Leaving RH', value: '90 – 95%' },
    ],
    seeAlso: ['apparatus-dew-point', 'bypass-factor', 'shr'],
  },

  heating: {
    id: 'heating',
    title: 'Heating coil',
    kind: 'Sensible heating',
    icon: icon('heating'),
    moves: [
      { property: 'tdb', direction: 'up' },
      { property: 'w', direction: 'constant' },
      { property: 'h', direction: 'up' },
      { property: 'rh', direction: 'down' },
    ],
    text:
      'A horizontal move to the right at constant humidity ratio. No moisture ' +
      'is exchanged, so relative humidity falls as the air warms — the same ' +
      'water in air that can now hold more of it.',
    check:
      'Humidity ratio must be identical across the coil. Watch leaving RH in ' +
      'winter: heating very dry air without humidification can drop space ' +
      'humidity below both comfort and static-sensitive limits.',
    rule: heatingCoilCheck,
    typical: [{ label: 'Preheat leaving air', value: '45 – 55 °F (7 – 13 °C)' }],
    seeAlso: ['sensible-heat', 'relative-humidity'],
  },

  fan: {
    id: 'fan',
    title: 'Fan',
    kind: 'Sensible heat gain',
    icon: icon('fan'),
    moves: [
      { property: 'tdb', direction: 'up' },
      { property: 'w', direction: 'constant' },
      { property: 'h', direction: 'up' },
    ],
    text:
      'Fan and motor losses end up in the airstream as sensible heat: a short ' +
      'horizontal move right. Typically 0.5–2 °F (0.3–1.1 K), and routinely ' +
      'forgotten — after which the space runs warm at design load and nobody ' +
      'can find the missing capacity.',
    check:
      'Humidity ratio must not change across a fan. Draw-through and ' +
      'blow-through placement decide whether the gain lands before or after the ' +
      'coil, which changes the coil duty — so model the fan where it really is, ' +
      'not where it is convenient.',
    rule: fanCheck,
    typical: [
      { label: 'Temperature rise', value: '0.5 – 2 °F (0.3 – 1.1 K)' },
      { label: 'Motor out of airstream', value: 'only shaft power heats the air' },
    ],
    seeAlso: ['sensible-heat'],
  },

  room: {
    id: 'room',
    title: 'Room / zone',
    kind: 'Space load line (RSHR)',
    icon: icon('room'),
    moves: [
      { property: 'tdb', direction: 'up' },
      { property: 'w', direction: 'up' },
      { property: 'slope', direction: 'set-by-load' },
    ],
    text:
      'Supply air absorbs the space’s sensible and latent gains and arrives at ' +
      'the room condition. The slope of this line is the room sensible heat ' +
      'ratio — fixed by the loads, not chosen by the designer. The protractor ' +
      'in the chart corner exists to draw it.',
    check:
      'The supply point must sit on the RSHR line drawn through the room ' +
      'setpoint. If it does not, temperature may hold while humidity drifts — ' +
      'the classic symptom of a supply condition that cannot satisfy the latent ' +
      'load. More airflow does not fix it; a drier supply condition does.',
    rule: roomCheck,
    typical: [
      { label: 'Office RSHR', value: '0.85 – 0.95' },
      { label: 'Assembly / high occupancy', value: '0.65 – 0.80' },
      { label: 'Supply air ΔT', value: '18 – 22 °F (10 – 12 K)' },
    ],
    seeAlso: ['shr', 'protractor', 'comfort-zone'],
  },

  'humidifier-steam': {
    id: 'humidifier-steam',
    title: 'Steam humidifier',
    kind: 'Isothermal humidification',
    icon: icon('humidifier-steam'),
    moves: [
      { property: 'w', direction: 'up' },
      { property: 'tdb', direction: 'up', qualifier: 'only slightly' },
      { property: 'h', direction: 'up' },
    ],
    text:
      'Dry steam injects moisture with only a small sensible gain, so the ' +
      'process is a near-vertical climb on the chart. The enthalpy rise equals ' +
      'the moisture added times the enthalpy of the steam — which is why steam ' +
      'humidification costs energy where adiabatic humidification does not.',
    check:
      'Confirm the absorption distance. Steam must fully absorb before the next ' +
      'component or duct sensor, or you will see condensation in the duct and ' +
      'false humidity readings at the sensor. Check leaving RH stays comfortably ' +
      'below saturation at the coldest downstream surface, not just on average.',
    rule: steamHumidifierCheck,
    typical: [
      { label: 'Absorption distance', value: '3 – 10 ft (1 – 3 m), per manufacturer' },
      { label: 'Winter space RH', value: '30 – 50%' },
    ],
    seeAlso: ['humidity-ratio', 'enthalpy'],
  },

  'humidifier-adiabatic': {
    id: 'humidifier-adiabatic',
    title: 'Adiabatic humidifier',
    kind: 'Evaporative cooling + humidification',
    icon: icon('humidifier-adiabatic'),
    moves: [
      { property: 'tdb', direction: 'down' },
      { property: 'w', direction: 'up' },
      { property: 'h', direction: 'constant', qualifier: 'very nearly' },
      { property: 'twb', direction: 'constant' },
    ],
    text:
      'Water evaporates into the airstream using heat taken from the air ' +
      'itself, so the state slides down the constant wet-bulb line toward ' +
      'saturation. Effectiveness sets how far along that line it travels. The ' +
      'humidification is free; the cooling comes with it whether wanted or not.',
    check:
      'The leaving dry bulb can never go below the entering wet bulb — that is ' +
      'the physical limit, not a performance figure. If a supplier’s datasheet ' +
      'implies otherwise, the entering condition on that datasheet is not yours.',
    rule: adiabaticCheck,
    typical: [
      { label: 'Wetted media effectiveness', value: '80 – 90%' },
      { label: 'High-pressure fog', value: '85 – 95%' },
    ],
    seeAlso: ['wet-bulb', 'adiabatic-saturation'],
  },

  'recovery-wheel-sensible': {
    id: 'recovery-wheel-sensible',
    title: 'Sensible recovery wheel',
    kind: 'Sensible heat recovery',
    icon: icon('recovery-wheel-sensible'),
    moves: [
      { property: 'tdb', direction: 'between', qualifier: 'toward the exhaust condition' },
      { property: 'w', direction: 'constant' },
    ],
    text:
      'A rotating matrix carries heat — and only heat — between the supply and ' +
      'exhaust airstreams. The supply moves horizontally toward the exhaust ' +
      'temperature; the exhaust moves the opposite way by whatever conserves ' +
      'energy at its own mass flow. Effectiveness is referenced to the smaller ' +
      'of the two mass flows, which is what limits the transfer.',
    check:
      'A sensible wheel that appears to change humidity ratio is either an ' +
      'enthalpy wheel or a leak. Check the purge and the pressure relationship ' +
      'across the wheel: cross-leakage of a few percent is normal, and it is ' +
      'the reason wheels are not used where contamination matters.',
    rule: sensibleWheelCheck,
    typical: [
      { label: 'Sensible effectiveness', value: '70 – 85%' },
      { label: 'Cross-leakage', value: '1 – 5% with purge' },
    ],
    seeAlso: ['effectiveness', 'sensible-heat'],
  },

  'recovery-wheel-enthalpy': {
    id: 'recovery-wheel-enthalpy',
    title: 'Enthalpy recovery wheel',
    kind: 'Total heat recovery',
    icon: icon('recovery-wheel-enthalpy'),
    moves: [
      { property: 'tdb', direction: 'between', qualifier: 'toward the exhaust condition' },
      { property: 'w', direction: 'between', qualifier: 'toward the exhaust condition' },
      { property: 'h', direction: 'between' },
    ],
    text:
      'A desiccant-coated matrix moves moisture as well as heat, so the supply ' +
      'state travels toward the exhaust state on both axes. In a humid climate ' +
      'the latent half is the larger prize: pre-drying outdoor air unloads the ' +
      'cooling coil far more than pre-cooling it does.',
    check:
      'Sensible and latent effectiveness are different numbers and are rated ' +
      'separately — a single quoted figure usually means someone has reported ' +
      'total effectiveness and it should not be applied to both. Check winter ' +
      'frost risk on the exhaust side, which is where enthalpy wheels fail.',
    rule: enthalpyWheelCheck,
    typical: [
      { label: 'Sensible effectiveness', value: '70 – 85%' },
      { label: 'Latent effectiveness', value: '65 – 80%' },
    ],
    seeAlso: ['effectiveness', 'enthalpy', 'humidity-ratio'],
  },

  'recovery-plate': {
    id: 'recovery-plate',
    title: 'Plate heat exchanger',
    kind: 'Sensible heat recovery',
    icon: icon('recovery-plate'),
    moves: [
      { property: 'tdb', direction: 'between', qualifier: 'toward the exhaust condition' },
      { property: 'w', direction: 'constant' },
    ],
    text:
      'Fixed plates keep the two airstreams physically separate while heat ' +
      'passes through the plate material. Nothing rotates and nothing is ' +
      'shared, so cross-contamination is effectively zero — which is why plates ' +
      'are chosen for laboratories and healthcare over the more effective wheel.',
    check:
      'Sensible only, so humidity ratio holds. Below freezing the exhaust side ' +
      'condenses and then frosts, and the usual answers — face-and-bypass, ' +
      'preheat, or a defrost cycle — all cost some of the recovery you just ' +
      'claimed. Check that the winter case still works with the defrost running.',
    rule: plateCheck,
    typical: [
      { label: 'Sensible effectiveness', value: '50 – 75%' },
      { label: 'Cross-contamination', value: 'effectively none' },
    ],
    seeAlso: ['effectiveness', 'dew-point'],
  },

  'recovery-runaround': {
    id: 'recovery-runaround',
    title: 'Run-around coil loop',
    kind: 'Sensible heat recovery',
    icon: icon('recovery-runaround'),
    moves: [
      { property: 'tdb', direction: 'between', qualifier: 'toward the exhaust condition' },
      { property: 'w', direction: 'constant' },
    ],
    text:
      'A pumped water or glycol loop couples a coil in this airstream to a coil ' +
      'in a secondary stream, usually exhaust. Heat moves between the streams ' +
      'with no air path at all, so the two air handlers need not be anywhere ' +
      'near each other. Sensible only: a horizontal move.',
    check:
      'Loop effectiveness of 45–65% is realistic for a two-coil run-around, and ' +
      'claims above that need scrutiny — there are two heat exchangers in ' +
      'series here, not one. Verify the pump energy is counted against the ' +
      'recovery benefit; on a mild day it can exceed it.',
    rule: runaroundCheck,
    typical: [
      { label: 'Loop effectiveness', value: '45 – 65%' },
      { label: 'Glycol concentration', value: '30 – 40% for freeze protection' },
    ],
    seeAlso: ['effectiveness'],
  },

  'recovery-wraparound-precool': {
    id: 'recovery-wraparound-precool',
    title: 'Wrap-around coil — pre-cool leg',
    kind: 'Passive heat recovery (upstream leg)',
    icon: icon('recovery-wraparound-precool'),
    moves: [
      { property: 'tdb', direction: 'down' },
      { property: 'w', direction: 'constant' },
    ],
    text:
      'The upstream leg of a wrap-around heat-pipe or pumped circuit pre-cools ' +
      'air before the cooling coil. It unloads the coil and, more usefully, ' +
      'deepens dehumidification for the same coil duty — the air arrives at the ' +
      'coil closer to its dew point, so more of the coil’s work goes into latent.',
    check:
      'The pre-cool and reheat legs must balance: the temperature drop here ' +
      'equals the rise on the reheat leg, same airflow, sensible only. If the ' +
      'model shows otherwise, energy is being created somewhere.',
    typical: [{ label: 'Typical ΔT per leg', value: '6 – 12 °F (3 – 7 K)' }],
    seeAlso: ['recovery-wraparound-reheat', 'sensible-heat'],
  },

  'recovery-wraparound-reheat': {
    id: 'recovery-wraparound-reheat',
    title: 'Wrap-around coil — reheat leg',
    kind: 'Passive heat recovery (downstream leg)',
    icon: icon('recovery-wraparound-reheat'),
    moves: [
      { property: 'tdb', direction: 'up' },
      { property: 'w', direction: 'constant' },
    ],
    text:
      'The downstream leg returns the recovered heat after the cooling coil — ' +
      'free reheat that lifts cold, saturated off-coil air away from saturation ' +
      'with no new energy input. This is the reason a wrap-around exists: ' +
      'dehumidification without paying twice.',
    check:
      'Confirm the reheat ΔT equals the pre-cool ΔT, and that the leaving ' +
      'condition still satisfies the space RSHR line. Free reheat that ' +
      'overshoots the supply temperature is not free any more — it has to be ' +
      'cooled back off.',
    rule: wraparoundReheatCheck,
    typical: [{ label: 'Typical ΔT per leg', value: '6 – 12 °F (3 – 7 K)' }],
    seeAlso: ['recovery-wraparound-precool', 'shr'],
  },

  'evaporative-direct': {
    id: 'evaporative-direct',
    title: 'Direct evaporative cooler',
    kind: 'Adiabatic saturation',
    icon: icon('evaporative-direct'),
    moves: [
      { property: 'tdb', direction: 'down' },
      { property: 'w', direction: 'up' },
      { property: 'twb', direction: 'constant' },
      { property: 'h', direction: 'constant', qualifier: 'very nearly' },
    ],
    text:
      'Air passes through wetted media and gives up sensible heat to evaporate ' +
      'water into itself. The state slides down the constant wet-bulb line — ' +
      'the same process as an adiabatic humidifier, named for the intent rather ' +
      'than the physics. Cheap to run and it uses no refrigerant at all.',
    check:
      'The entering wet bulb is a hard floor on the leaving dry bulb, so the ' +
      'climate decides whether this works before the equipment does. In a humid ' +
      'climate the available depression is small and the added moisture is a ' +
      'cost, not a benefit. Check the water treatment and drift regime too.',
    rule: adiabaticCheck,
    typical: [
      { label: 'Media effectiveness', value: '80 – 90%' },
      { label: 'Suits climates with', value: 'wet-bulb depression above 15 °F (8 K)' },
    ],
    seeAlso: ['wet-bulb', 'adiabatic-saturation'],
  },

  'evaporative-indirect': {
    id: 'evaporative-indirect',
    title: 'Indirect evaporative cooler',
    kind: 'Sensible cooling',
    icon: icon('evaporative-indirect'),
    moves: [
      { property: 'tdb', direction: 'down' },
      { property: 'w', direction: 'constant' },
      { property: 'h', direction: 'down' },
      { property: 'rh', direction: 'up' },
    ],
    text:
      'A secondary airstream is evaporatively cooled and then used to cool the ' +
      'primary air through a surface, so the primary air is cooled without ' +
      'being wetted. On the chart it is a horizontal move left: sensible ' +
      'cooling, no moisture, no refrigerant. The floor is the secondary ' +
      'stream’s wet bulb, reached through two effectivenesses in series.',
    check:
      'Two effectivenesses multiply here — the evaporative stage and the heat ' +
      'exchanger — so the achievable approach is worse than either alone. Check ' +
      'what the secondary airstream is: using exhaust air gives a lower wet bulb ' +
      'than outdoor air and changes the answer materially.',
    rule: indirectEvaporativeCheck,
    typical: [
      { label: 'Overall effectiveness', value: '55 – 80%' },
      { label: 'Secondary air', value: 'exhaust where available' },
    ],
    seeAlso: ['wet-bulb', 'effectiveness'],
  },

  desiccant: {
    id: 'desiccant',
    title: 'Desiccant wheel',
    kind: 'Isenthalpic dehumidification (idealised)',
    icon: icon('desiccant'),
    moves: [
      { property: 'w', direction: 'down' },
      { property: 'tdb', direction: 'up' },
      { property: 'h', direction: 'constant', qualifier: 'in this idealisation' },
      { property: 'rh', direction: 'down' },
    ],
    text:
      'A desiccant adsorbs water vapour from the airstream and releases the ' +
      'latent heat of that water as sensible heat, so the air leaves drier and ' +
      'hotter. It is the only process here that dehumidifies without going ' +
      'below the dew point, which is why it reaches humidity levels a cooling ' +
      'coil cannot.',
    check:
      'This tool models the wheel as isenthalpic — the state moves along a ' +
      'constant-enthalpy line. A real wheel runs slightly above that line, and ' +
      'more importantly it needs a regeneration airstream at 150–290 °F ' +
      '(65–140 °C) that this model does not account for. Size the regeneration ' +
      'heat separately; it is usually the dominant energy cost.',
    rule: desiccantCheck,
    typical: [
      { label: 'Regeneration temperature', value: '150 – 290 °F (65 – 140 °C)' },
      { label: 'Moisture removal', value: 'up to about 80% per pass' },
    ],
    seeAlso: ['enthalpy', 'humidity-ratio', 'dew-point'],
  },
} as Record<StageType, EducationEntry>);

export function educationFor(type: StageType): EducationEntry | undefined {
  return EQUIPMENT[type];
}
