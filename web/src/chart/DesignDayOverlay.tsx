/**
 * ASHRAE design conditions, drawn on the chart.
 *
 * These are single points, not a process, and they are marked differently from
 * one: a diamond with a two-letter tag rather than a numbered circle. The
 * distinction matters because they mean different things. A numbered circle is
 * a stage in *this* system; a diamond is a condition the weather imposes on
 * whatever system you build, and it stays put while the design changes around
 * it.
 *
 * Drawn beneath the process chain so a state point never disappears behind a
 * design marker — the chain is the thing being worked on.
 */
import type { ChartScales } from './scales.js';
import type { DesignDay, DesignDayKind } from '../weather/ddy.js';

export interface DesignDayOverlayProps {
  days: readonly DesignDay[];
  scales: ChartScales;
  selected: DesignDayKind | null;
  onSelect: (kind: DesignDayKind | null) => void;
}

/** Half-diagonal of the marker, in pixels. */
const SIZE = 7;
const SELECTED_SIZE = 9.5;

export function DesignDayOverlay({
  days,
  scales,
  selected,
  onSelect,
}: DesignDayOverlayProps): React.JSX.Element {
  return (
    <g className="design-days">
      {days.map((day) => {
        const { x, y } = scales.project(day.state.tdb, day.state.w);
        // A condition outside the current view is skipped rather than clamped
        // to the frame: a marker pinned to the edge claims a temperature the
        // station does not have.
        if (!scales.containsPixel(x, y)) return null;

        const isSelected = selected === day.kind;
        const r = isSelected ? SELECTED_SIZE : SIZE;

        return (
          <g
            key={day.kind}
            className={`design-day${isSelected ? ' selected' : ''}`}
            onClick={() => onSelect(isSelected ? null : day.kind)}
            role="button"
            tabIndex={0}
            aria-label={`${day.label} condition`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(isSelected ? null : day.kind);
              }
            }}
          >
            <polygon points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`} />
            {/* Tag to the upper right, where it clears the saturation curve for
                the cold conditions and the chart's own labels for the warm. */}
            <text
              className="design-day-tag"
              x={x + r + 3}
              y={y - r + 2}
              textAnchor="start"
            >
              {day.tag}
            </text>
          </g>
        );
      })}
    </g>
  );
}
