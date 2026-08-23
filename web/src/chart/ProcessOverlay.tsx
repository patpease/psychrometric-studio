/**
 * The process chain drawn on the chart.
 *
 * Each solved stage contributes a numbered state point, and consecutive points
 * are joined by a process line. Two of those lines are *not* straight and must
 * not be drawn as if they were:
 *
 *  - **Adiabatic humidification** follows the constant wet-bulb line, which is
 *    gently curved. A straight chord would cut below it and imply the air got
 *    drier on the way than it did.
 *  - **Cooling with dehumidification** is drawn straight here, which is the
 *    conventional representation; the true path bends toward the apparatus dew
 *    point, and that construction arrives in Phase 4.
 */
import { useRef } from 'react';
import { lib } from '../psych/psychrolib.js';
import type { MoistAirState } from '../psych/state.js';
import type { SolvedAirstream } from '../processes/chain.js';
import type { ChartScales, DataPoint } from './scales.js';
import type { StageType } from '../types/project.js';

export interface ProcessOverlayProps {
  solved: SolvedAirstream;
  scales: ChartScales;
  pressure: number;
  /** Index of the selected stage, or null. */
  selected: number | null;
  onSelect: (index: number | null) => void;
  /**
   * Move a draggable state point to a new condition.
   *
   * **Only entering-air points are draggable, and that is a statement about
   * psychrometrics rather than a limitation.** A source is an *input*: its
   * position is two free variables the user chose. Every downstream point is an
   * *output* computed from the stage above it, so "dragging" one would have to
   * silently pick which parameter to invert — change the coil's leaving
   * temperature? its capacity? its SHR? — and any choice would be the tool
   * putting words in the engineer's mouth. Downstream points are edited through
   * their parameters, where the intent is explicit.
   */
  onDragState?: ((stageIndex: number, tdb: number, w: number) => void) | undefined;
  /** Client-pixel to psychrometric-space conversion, for dragging. */
  toData?: ((clientX: number, clientY: number) => DataPoint | null) | undefined;
}

/** Number of intermediate points used to curve a non-linear process line. */
const CURVE_SAMPLES = 24;

/**
 * The path a process takes between two states.
 *
 * Straight for everything except adiabatic humidification, which follows the
 * entering wet bulb.
 */
function processPath(
  from: MoistAirState,
  to: MoistAirState,
  type: StageType,
  pressure: number,
): DataPoint[] {
  if (type !== 'humidifier-adiabatic') {
    return [
      { tdb: from.tdb, w: from.w },
      { tdb: to.tdb, w: to.w },
    ];
  }

  const psy = lib(from.units);
  const points: DataPoint[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i += 1) {
    const tdb = from.tdb + ((to.tdb - from.tdb) * i) / CURVE_SAMPLES;
    points.push({ tdb, w: psy.GetHumRatioFromTWetBulb(tdb, from.twb, pressure) });
  }
  return points;
}

export function ProcessOverlay({
  solved,
  scales,
  pressure,
  selected,
  onSelect,
  onDragState,
  toData,
}: ProcessOverlayProps): React.JSX.Element {
  const stages = solved.stages.filter((stage) => stage.result);
  const canDrag = Boolean(onDragState && toData);

  /**
   * Which stage is being dragged, if any.
   *
   * Tracked explicitly rather than inferred from `hasPointerCapture`: capture
   * can be lost mid-gesture (a alt-tab, a re-render that replaces the node),
   * and a drag that silently stops responding is worse than one that ends.
   */
  const dragging = useRef<number | null>(null);

  const toPixels = (point: DataPoint): string => {
    const { x, y } = scales.project(point.tdb, point.w);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };

  return (
    <g className="process-overlay">
      {/* Process lines, drawn first so the markers sit above them. */}
      {stages.map((stage, position) => {
        if (position === 0) return null;
        const from = stages[position - 1]!.result!.state;
        const to = stage.result!.state;
        const path = processPath(from, to, stage.stage.type, pressure);
        const isSelected = selected === stage.index;

        return (
          <polyline
            key={`line-${stage.stage.id}`}
            className={`process-line${isSelected ? ' selected' : ''}`}
            points={path.map(toPixels).join(' ')}
            markerEnd="url(#process-arrow)"
          />
        );
      })}

      {/* A mixing box's second stream, tied to the mix point it produced. */}
      {stages.flatMap((stage) =>
        (stage.result!.auxiliary ?? []).map((auxiliary) => {
          const mix = scales.project(stage.result!.state.tdb, stage.result!.state.w);
          const aux = scales.project(auxiliary.state.tdb, auxiliary.state.w);
          return (
            <g key={`aux-${stage.stage.id}-${auxiliary.label}`} className="process-auxiliary">
              <line x1={aux.x} y1={aux.y} x2={mix.x} y2={mix.y} />
              <circle cx={aux.x} cy={aux.y} r={5} />
            </g>
          );
        }),
      )}

      {/* Coil construction: the process line extended to the apparatus dew
          point on the saturation curve. Shown only for the selected stage —
          drawn for every coil at once it would clutter the chart, and it is a
          construction you look at deliberately rather than at a glance. */}
      {stages.map((stage) => {
        const coil = stage.result!.coil;
        if (!coil || coil.adp === null || selected !== stage.index) return null;

        const position = stages.indexOf(stage);
        const from = position > 0 ? stages[position - 1]!.result!.state : null;
        if (!from) return null;

        const leaving = scales.project(stage.result!.state.tdb, stage.result!.state.w);
        const adp = scales.project(coil.adpState!.tdb, coil.adpState!.w);

        return (
          <g key={`adp-${stage.stage.id}`} className="coil-construction">
            <line x1={leaving.x} y1={leaving.y} x2={adp.x} y2={adp.y} />
            <circle cx={adp.x} cy={adp.y} r={4} />
            <text x={adp.x} y={adp.y} dx={-6} dy={-6} textAnchor="end">
              ADP
            </text>
          </g>
        );
      })}

      {/* State points. */}
      {stages.map((stage, position) => {
        const { x, y } = scales.project(stage.result!.state.tdb, stage.result!.state.w);
        const isSelected = selected === stage.index;
        const hasWarning = stage.result!.warnings.length > 0;
        const draggable = canDrag && stage.stage.type === 'source';

        const handleDrag = (event: React.PointerEvent<SVGGElement>): void => {
          if (!draggable) return;
          // Stop the chart's own pan handler from also claiming this gesture.
          event.stopPropagation();
          event.preventDefault();
          dragging.current = stage.index;
          // Capture is best-effort: it keeps the gesture alive outside the
          // marker, but the ref above is what decides whether a drag is live.
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            /* not all pointers can be captured; the drag still works */
          }
        };

        const handleMove = (event: React.PointerEvent<SVGGElement>): void => {
          if (dragging.current !== stage.index) return;
          event.stopPropagation();
          const point = toData!(event.clientX, event.clientY);
          if (point) onDragState!(stage.index, point.tdb, point.w);
        };

        const handleRelease = (event: React.PointerEvent<SVGGElement>): void => {
          dragging.current = null;
          try {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          } catch {
            /* nothing to release */
          }
        };

        return (
          <g
            key={`point-${stage.stage.id}`}
            className={
              `process-point${isSelected ? ' selected' : ''}` +
              `${hasWarning ? ' warned' : ''}${draggable ? ' draggable' : ''}`
            }
            onPointerDown={handleDrag}
            onPointerMove={handleMove}
            onPointerUp={handleRelease}
            onPointerCancel={handleRelease}
            onClick={() => onSelect(isSelected ? null : stage.index)}
            role="button"
            tabIndex={0}
            aria-label={`${stage.displayName} state point`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(isSelected ? null : stage.index);
              }
            }}
          >
            <circle cx={x} cy={y} r={isSelected ? 9 : 7} />
            <text x={x} y={y} dy="0.32em" textAnchor="middle">
              {position + 1}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Arrowhead marker, defined once in the chart's `<defs>`. */
export function ProcessArrowMarker(): React.JSX.Element {
  return (
    <marker
      id="process-arrow"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="5"
      markerHeight="5"
      orient="auto-start-reverse"
    >
      <path d="M0,1 L9,5 L0,9 z" className="process-arrowhead" />
    </marker>
  );
}
