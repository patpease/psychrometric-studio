/**
 * Every property of one condition of moist air, as a definition list.
 *
 * One component for the two places it is read: the "Condition at cursor"
 * section on a desk, which follows the mouse, and the card pinned over the
 * chart on a phone, which follows a tap. Written once so the two cannot show
 * a different set of properties, or the same property to a different number
 * of places.
 */
import type { MoistAirState } from '../psych/state.js';
import type { UnitSystem } from '../psych/units.js';
import {
  formatDensity,
  formatEnthalpy,
  formatHumidityRatio,
  formatRelativeHumidity,
  formatSpecificVolume,
  formatTemperature,
  formatVapourPressure,
} from './format.js';

export function ConditionReadout({
  state,
  units,
}: {
  state: MoistAirState;
  units: UnitSystem;
}): React.JSX.Element {
  return (
    <dl className="readout">
      <dt>Dry bulb</dt>
      <dd>{formatTemperature(state.tdb, units, true)}</dd>
      <dt>Wet bulb</dt>
      <dd>{formatTemperature(state.twb, units, true)}</dd>
      <dt>Dew point</dt>
      <dd>{formatTemperature(state.tdp, units, true)}</dd>
      <dt>Relative humidity</dt>
      <dd>{formatRelativeHumidity(state.rh, true)}</dd>
      <dt>Humidity ratio</dt>
      <dd>{formatHumidityRatio(state.w, units, true)}</dd>
      <dt>Enthalpy</dt>
      <dd>{formatEnthalpy(state.h, units, true)}</dd>
      <dt>Specific volume</dt>
      <dd>{formatSpecificVolume(state.v, units, true)}</dd>
      <dt>Density</dt>
      <dd>{formatDensity(state.density, units, true)}</dd>
      <dt>Vapour pressure</dt>
      <dd>{formatVapourPressure(state.vapourPressure, units, true)}</dd>
    </dl>
  );
}
