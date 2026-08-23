/**
 * ASHRAE 55 comfort zones, filled on the psychrometric chart.
 *
 * Drawn beneath the process chain so that a process line crossing a zone stays
 * readable — the zone is context for the process, not the subject.
 */
import type { ComfortZone } from '../comfort/polygon.js';
import type { ChartScales } from './scales.js';

export interface ComfortOverlayProps {
  zones: readonly ComfortZone[];
  scales: ChartScales;
}

export function ComfortOverlay({ zones, scales }: ComfortOverlayProps): React.JSX.Element {
  return (
    <g className="comfort-overlay">
      {zones.map((zone, index) => {
        if (zone.points.length < 3) return null;

        const path = zone.points
          .map((point, i) => {
            const { x, y } = scales.project(point.tdb, point.w);
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
          })
          .join(' ');

        // Index rather than clo in the class, so the two zones are visually
        // distinct whatever clothing levels the user has chosen.
        return (
          <g key={zone.label} className={`comfort-zone comfort-zone-${index}`}>
            <path d={`${path} Z`} />
          </g>
        );
      })}
    </g>
  );
}

/** Legend entries for the drawn zones, for the controls panel. */
export function comfortZoneLegend(zones: readonly ComfortZone[]): {
  label: string;
  className: string;
  empty: boolean;
}[] {
  return zones.map((zone, index) => ({
    label: zone.label,
    className: `comfort-zone-${index}`,
    empty: zone.points.length < 3,
  }));
}
