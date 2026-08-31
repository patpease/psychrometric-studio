/**
 * The adaptive comfort chart: indoor operative temperature against prevailing
 * mean outdoor temperature.
 *
 * A separate chart rather than an overlay, because the adaptive model has no
 * humidity term — there is no axis on the psychrometric chart to put it on.
 * That absence is the model itself talking: adaptation is taken to absorb
 * humidity and the personal factors, which is exactly why the model is narrow
 * in application.
 */
import { adaptiveBands, ADAPTIVE_LIMITS } from '../comfort/adaptive.js';
import { fromCelsius } from '../comfort/pmv.js';
import { LABELS, type UnitSystem } from '../psych/units.js';
import { formatTemperature } from './format.js';

export interface AdaptiveChartProps {
  units: UnitSystem;
  /** The operating point: indoor operative and prevailing outdoor temperature. */
  indoor: number;
  prevailing: number;
  width?: number;
  height?: number;
}

const MARGIN = { top: 10, right: 10, bottom: 30, left: 34 };

export function AdaptiveChart({
  units,
  indoor,
  prevailing,
  width = 288,
  height = 190,
}: AdaptiveChartProps): React.JSX.Element {
  const bands = adaptiveBands(units);
  const [start, end] = bands as [(typeof bands)[0], (typeof bands)[0]];

  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;

  // The x range is the model's own domain; the y range spans the widest band
  // with a little air, so the 80% edges are never clipped by the frame.
  const xMin = start.prevailing;
  const xMax = end.prevailing;
  const yMin = Math.min(start.low80, end.low80) - (units === 'IP' ? 4 : 2);
  const yMax = Math.max(start.up80, end.up80) + (units === 'IP' ? 4 : 2);

  const x = (value: number): number =>
    MARGIN.left + ((value - xMin) / (xMax - xMin)) * plotWidth;
  const y = (value: number): number =>
    MARGIN.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;

  const bandPath = (lowKey: 'low80' | 'low90', upKey: 'up80' | 'up90'): string =>
    `M${x(start.prevailing)},${y(start[upKey])} ` +
    `L${x(end.prevailing)},${y(end[upKey])} ` +
    `L${x(end.prevailing)},${y(end[lowKey])} ` +
    `L${x(start.prevailing)},${y(start[lowKey])} Z`;

  const inDomain = prevailing >= xMin && prevailing <= xMax;

  const ticks = (min: number, max: number, count: number): number[] => {
    const step = (max - min) / count;
    return Array.from({ length: count + 1 }, (_, i) => min + i * step);
  };

  return (
    <svg
      className="adaptive-chart"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Adaptive comfort chart"
    >
      <rect
        x={MARGIN.left}
        y={MARGIN.top}
        width={plotWidth}
        height={plotHeight}
        className="adaptive-bg"
      />

      <path d={bandPath('low80', 'up80')} className="adaptive-band-80" />
      <path d={bandPath('low90', 'up90')} className="adaptive-band-90" />

      <line
        x1={x(start.prevailing)}
        y1={y(start.comfort)}
        x2={x(end.prevailing)}
        y2={y(end.comfort)}
        className="adaptive-neutral"
      />

      {/* The operating point, drawn only where the model applies. */}
      {inDomain && (
        <circle cx={x(prevailing)} cy={y(indoor)} r={4.5} className="adaptive-point" />
      )}

      <rect
        x={MARGIN.left}
        y={MARGIN.top}
        width={plotWidth}
        height={plotHeight}
        className="adaptive-frame"
      />

      <g className="adaptive-axis">
        {ticks(xMin, xMax, 4).map((value) => (
          <text key={`x-${value}`} x={x(value)} y={height - 14} textAnchor="middle">
            {formatTemperature(value, units)}
          </text>
        ))}
        {ticks(yMin, yMax, 3).map((value) => (
          <text key={`y-${value}`} x={MARGIN.left - 4} y={y(value)} dy="0.32em" textAnchor="end">
            {formatTemperature(value, units)}
          </text>
        ))}
        <text className="adaptive-axis-title" x={width / 2} y={height - 2} textAnchor="middle">
          Prevailing mean outdoor ({LABELS[units].temperature})
        </text>
      </g>

      {!inDomain && (
        <text className="adaptive-outside" x={width / 2} y={MARGIN.top + plotHeight / 2} textAnchor="middle">
          Outside the model’s range
        </text>
      )}
    </svg>
  );
}

/** The adaptive model's outdoor range in the app's units, for input hints. */
export function adaptiveRange(units: UnitSystem): [number, number] {
  const { min, max } = ADAPTIVE_LIMITS.prevailingCelsius;
  return [fromCelsius(min, units), fromCelsius(max, units)];
}
