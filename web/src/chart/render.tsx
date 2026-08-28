/**
 * The chart renderer.
 *
 * Hand-authored SVG rather than a plotting library. A psychrometric chart is a
 * coordinate system, not a plot of data: curved gridlines, a domain clipped by
 * the saturation curve, labels that follow their curves, and overlays yet to
 * come. Plotting libraries fight all four. D3-style scales are enough, and
 * emitting SVG directly means vector export in Phase 7 is a DOM serialisation
 * rather than a second rendering path.
 */
import { memo, useCallback, useId, useMemo, useRef } from 'react';
import type { ChartDomain, ChartScales, DataPoint } from './scales.js';
import { createScales, niceTicks } from './scales.js';
import {
  saturationCurve,
  relativeHumidityLine,
  wetBulbLine,
  enthalpyLine,
  specificVolumeLine,
  dewPointLine,
  defaultTicks,
  type ChartLine,
  type FamilyKey,
} from './families.js';
import { FAMILY_STYLES, DRAW_ORDER, type FamilyStyle } from './theme.js';
import { protractorRays } from './protractor.js';
import { humidityRatioToDisplay, LABELS, type UnitSystem } from '../psych/units.js';
import { ProcessOverlay, ProcessArrowMarker } from './ProcessOverlay.js';
import { ComfortOverlay } from './ComfortOverlay.js';
import { DesignDayOverlay } from './DesignDayOverlay.js';
import type { DesignDay, DesignDayKind } from '../weather/ddy.js';
import type { ComfortZone } from '../comfort/polygon.js';
import type { SolvedAirstream } from '../processes/chain.js';
import { formatTemperature, lineLabel } from '../ui/format.js';
import type { MoistAirState } from '../psych/state.js';

export interface ChartProps {
  domain: ChartDomain;
  pressure: number;
  units: UnitSystem;
  width: number;
  height: number;
  visibility: Record<FamilyKey, boolean>;
  showProtractor: boolean;
  /** State under the cursor, or null when the pointer is off-chart. */
  hover: MoistAirState | null;
  /** The solved process chain to draw over the chart, if any. */
  solved?: SolvedAirstream | undefined;
  selectedStage?: number | null;
  onSelectStage?: ((index: number | null) => void) | undefined;
  onDragState?: ((stageIndex: number, tdb: number, w: number) => void) | undefined;
  /** ASHRAE 55 comfort zones to fill beneath the process chain. */
  comfortZones?: readonly ComfortZone[] | undefined;
  /** ASHRAE design conditions from a loaded weather archive's `.ddy`. */
  designDays?: readonly DesignDay[] | undefined;
  selectedDesignDay?: DesignDayKind | null;
  onSelectDesignDay?: ((kind: DesignDayKind | null) => void) | undefined;
  /**
   * Receives the live `<svg>` element, for export.
   *
   * The chart already keeps a ref of its own for hit-testing; this hands the
   * same element out rather than re-querying the DOM by class name, which would
   * be a second way to find the chart and one that breaks silently when the
   * class changes.
   *
   * Two charts are mounted so the page can turn between operating cases, and
   * only the one on screen is given this — so a chart behind another can never
   * answer for it. The assignment is guarded rather than unconditional,
   * because the face losing the ref detaches with the *old* closure still
   * holding it, and an unguarded write there would null the ref the face in
   * front had just set.
   */
  exportRef?: React.RefObject<SVGSVGElement | null> | undefined;
}

/** Build an SVG path from points in psychrometric space. */
function pathFrom(points: readonly DataPoint[], scales: ChartScales): string {
  if (points.length === 0) return '';
  return points
    .map((p, i) => {
      const { x, y } = scales.project(p.tdb, p.w);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

/**
 * Angle in degrees of the line's tangent at a given point.
 *
 * Measured against the *next* point, or the previous one at the far end, so a
 * label always follows the direction the curve is actually travelling rather
 * than a chord across it.
 */
function tangentAngle(
  points: readonly DataPoint[],
  scales: ChartScales,
  index: number,
): number {
  if (points.length < 2) return 0;
  const i = Math.min(Math.max(index, 0), points.length - 1);
  const [a, b] = i === points.length - 1 ? [points[i - 1]!, points[i]!] : [points[i]!, points[i + 1]!];
  const pa = scales.project(a.tdb, a.w);
  const pb = scales.project(b.tdb, b.w);
  return (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI;
}

/** Which point of a line carries its label. */
function labelIndex(points: readonly DataPoint[], style: FamilyStyle): number {
  if (style.labelAt === 'start') return 0;
  if (style.labelAt === 'end') return points.length - 1;
  // Pulled one point clear of each end so a short trace — a curve clipped to a
  // sliver by zooming — still labels somewhere on itself rather than at a tip.
  const at = Math.round((style.labelFraction ?? 0.5) * (points.length - 1));
  return Math.min(Math.max(at, 1), Math.max(points.length - 2, 0));
}

function LineFamily({
  lines,
  family,
  scales,
}: {
  lines: ChartLine[];
  family: FamilyKey;
  scales: ChartScales;
}): React.JSX.Element {
  const style = FAMILY_STYLES[family];

  return (
    <g className={`family family-${family}`}>
      {lines.map((line, index) => {
        const atStart = style.labelAt === 'start';
        const onLine = style.labelAt === 'fraction';
        const at = labelIndex(line.points, style);
        const anchorPoint = line.points[at];
        if (!anchorPoint) return null;

        const anchor = scales.project(anchorPoint.tdb, anchorPoint.w);
        const angle = tangentAngle(line.points, scales, at);
        // Keep text upright: flip any label that would read upside-down.
        const upright = angle > 90 || angle < -90 ? angle + 180 : angle;

        return (
          <g key={`${line.value}-${index}`}>
            <path
              d={pathFrom(line.points, scales)}
              fill="none"
              stroke={style.colour}
              strokeWidth={style.width}
              strokeDasharray={style.dash}
              strokeLinecap="round"
            />
            {line.label && (
              <text
                className="line-label"
                x={anchor.x}
                y={anchor.y}
                dx={onLine ? 0 : atStart ? -style.labelOffset : style.labelOffset}
                dy={-3}
                textAnchor={onLine ? 'middle' : atStart ? 'end' : 'start'}
                transform={`rotate(${upright.toFixed(1)} ${anchor.x.toFixed(2)} ${anchor.y.toFixed(2)})`}
                fill={style.colour}
              >
                {line.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function Protractor({
  units,
  scales,
}: {
  units: UnitSystem;
  scales: ChartScales;
}): React.JSX.Element {
  const radius = 54;
  // Upper-left of the plot area, where the chart is empty because that region
  // is above the saturation curve.
  const cx = scales.margin.left + radius + 28;
  const cy = scales.margin.top + radius + 12;

  const pixelsPerDegree = scales.plotWidth / (scales.domain.tdbMax - scales.domain.tdbMin);
  const pixelsPerW = scales.plotHeight / (scales.domain.wMax - scales.domain.wMin);
  const rays = protractorRays(units, pixelsPerDegree, pixelsPerW);

  return (
    <g className="protractor">
      <circle cx={cx} cy={cy} r={radius} className="protractor-face" />
      <circle cx={cx} cy={cy} r={2.5} className="protractor-hub" />
      {rays.map((ray) => {
        const x2 = cx + ray.direction.dx * radius;
        const y2 = cy + ray.direction.dy * radius;
        const lx = cx + ray.direction.dx * (radius + 12);
        const ly = cy + ray.direction.dy * (radius + 12);
        return (
          <g key={ray.shr}>
            <line x1={cx} y1={cy} x2={x2} y2={y2} className="protractor-ray" />
            <text x={lx} y={ly} className="protractor-label" textAnchor="middle" dy="0.32em">
              {ray.label}
            </text>
          </g>
        );
      })}
      <text x={cx} y={cy + radius + 28} className="protractor-title" textAnchor="middle">
        SHR
      </text>
    </g>
  );
}

/**
 * The chart, skipped entirely when nothing about it has changed.
 *
 * Two of these are mounted so the page can turn between operating cases, and
 * on a turn only one of them actually changes — the other keeps the same
 * chain, view and overlays it had a moment ago. Without this it would still be
 * reconciled, twice a turn, for nothing.
 *
 * The comparison is shallow, so every array and callback reaching this
 * component has to be stable across renders that did not change it. The caller
 * owes that; see the shared empty arrays in App.
 */
export const Chart = memo(ChartView);

function ChartView({
  domain,
  pressure,
  units,
  width,
  height,
  visibility,
  showProtractor,
  hover,
  solved,
  selectedStage = null,
  onSelectStage,
  onDragState,
  comfortZones,
  designDays,
  selectedDesignDay = null,
  onSelectDesignDay,
  exportRef,
}: ChartProps): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  /**
   * Ids for this chart's own `<defs>`, unique to the instance.
   *
   * Two charts are mounted so the page can turn between operating cases, and a
   * document with two `id="plot-clip"` elements resolves every `url(#plot-clip)`
   * to the first one — so both charts would clip against a rectangle belonging
   * to the other. That was survivable while the two clips were identical
   * rectangles and stopped being survivable the moment one face was hidden: a
   * `clipPath` child that is not visible contributes nothing to the clip, and
   * both charts lost everything inside the plot while their axes carried on
   * drawing.
   *
   * The colons React puts in a generated id are legal in markup but awkward
   * everywhere else, so they come out.
   */
  const uid = useId().replace(/:/g, '');
  const clipId = `plot-clip-${uid}`;
  const arrowId = `process-arrow-${uid}`;

  const scales = useMemo(() => createScales(domain, width, height), [domain, width, height]);

  /**
   * Line families are recomputed whenever the domain, pressure, or unit system
   * changes — which is also exactly when they must be re-tessellated, so tying
   * the memo to those three keeps resolution correct as the user zooms.
   */
  const families = useMemo(() => {
    const ticks = defaultTicks(units);
    const result: Record<FamilyKey, ChartLine[]> = {
      saturation: [saturationCurve(domain, pressure, units)],
      relativeHumidity: ticks.relativeHumidity.flatMap((v) =>
        relativeHumidityLine(v, domain, pressure, units),
      ),
      wetBulb: ticks.wetBulb.flatMap((v) =>
        wetBulbLine(v, domain, pressure, units, (x) => lineLabel.wetBulb(x, units)),
      ),
      enthalpy: ticks.enthalpy.flatMap((v) =>
        enthalpyLine(v, domain, pressure, units, (x) => lineLabel.enthalpy(x, units)),
      ),
      specificVolume: ticks.specificVolume.flatMap((v) =>
        specificVolumeLine(v, domain, pressure, units, (x) => lineLabel.specificVolume(x, units)),
      ),
      dewPoint: ticks.dewPoint.flatMap((v) =>
        dewPointLine(v, domain, pressure, units, (x) => lineLabel.dewPoint(x, units)),
      ),
    };
    return result;
  }, [domain, pressure, units]);

  const xTicks = useMemo(() => niceTicks(domain.tdbMin, domain.tdbMax, 12), [domain]);
  const yTicks = useMemo(() => {
    // Ticks are chosen in display units so the labels are round numbers, then
    // converted back — picking them in lb/lb would give values like 0.0071.
    const displayMax = humidityRatioToDisplay(domain.wMax, units);
    const displayMin = humidityRatioToDisplay(domain.wMin, units);
    return niceTicks(displayMin, displayMax, 10).map((display) => ({
      display,
      w: units === 'IP' ? display / 7000 : display / 1000,
    }));
  }, [domain, units]);

  const plotLeft = scales.margin.left;
  const plotTop = scales.margin.top;
  const plotRight = plotLeft + scales.plotWidth;
  const plotBottom = plotTop + scales.plotHeight;

  const hoverPoint = hover ? scales.project(hover.tdb, hover.w) : null;

  /** Client pixels to psychrometric space, for dragging state points. */
  const toData = useCallback(
    (clientX: number, clientY: number) => {
      const element = svgRef.current;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return scales.invert(clientX - rect.left, clientY - rect.top);
    },
    [scales],
  );

  return (
    <svg
      ref={(node) => {
        svgRef.current = node;
        if (exportRef) exportRef.current = node;
      }}
      className="psych-chart"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Psychrometric chart"
    >
      <defs>
        {/* Everything inside the plot is clipped, so a family that runs past the
            frame is cut at the frame rather than drawn over the axes. */}
        <clipPath id={clipId}>
          <rect x={plotLeft} y={plotTop} width={scales.plotWidth} height={scales.plotHeight} />
        </clipPath>
        <ProcessArrowMarker id={arrowId} />
      </defs>

      <rect
        x={plotLeft}
        y={plotTop}
        width={scales.plotWidth}
        height={scales.plotHeight}
        className="plot-background"
      />

      <g clipPath={`url(#${clipId})`}>
        {/* Comfort zones sit behind everything: they are context for the
            chart, not a layer over it. */}
        {comfortZones && comfortZones.length > 0 && (
          <ComfortOverlay zones={comfortZones} scales={scales} />
        )}

        {/* Axis gridlines sit behind every family. */}
        <g className="gridlines">
          {xTicks.map((t) => {
            const { x } = scales.project(t, domain.wMin);
            return <line key={`gx-${t}`} x1={x} y1={plotTop} x2={x} y2={plotBottom} />;
          })}
          {yTicks.map((t) => {
            const { y } = scales.project(domain.tdbMin, t.w);
            return <line key={`gy-${t.display}`} x1={plotLeft} y1={y} x2={plotRight} y2={y} />;
          })}
        </g>

        {DRAW_ORDER.filter((family) => visibility[family]).map((family) => (
          <LineFamily key={family} family={family} lines={families[family]} scales={scales} />
        ))}

        {/*
          Above the gridlines and the line families, below the process chain.
          A design condition has to be findable at a glance — drawn under the
          families it disappears into them — but the chain is the thing being
          worked on and stays on top.
        */}
        {designDays && designDays.length > 0 && (
          <DesignDayOverlay
            days={designDays}
            scales={scales}
            selected={selectedDesignDay}
            onSelect={onSelectDesignDay ?? (() => undefined)}
          />
        )}

        {solved && (
          <ProcessOverlay
            solved={solved}
            scales={scales}
            pressure={pressure}
            arrowId={arrowId}
            selected={selectedStage}
            onSelect={onSelectStage ?? (() => undefined)}
            onDragState={onDragState}
            toData={toData}
          />
        )}

        {hoverPoint && (
          <g className="hover-marker">
            <line x1={plotLeft} y1={hoverPoint.y} x2={hoverPoint.x} y2={hoverPoint.y} />
            <line x1={hoverPoint.x} y1={hoverPoint.y} x2={hoverPoint.x} y2={plotBottom} />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r={4} />
          </g>
        )}
      </g>

      {showProtractor && <Protractor units={units} scales={scales} />}

      {/* Frame */}
      <rect
        x={plotLeft}
        y={plotTop}
        width={scales.plotWidth}
        height={scales.plotHeight}
        className="plot-frame"
      />

      {/* Dry-bulb axis, along the bottom */}
      <g className="axis axis-x">
        {xTicks.map((t) => {
          const { x } = scales.project(t, domain.wMin);
          return (
            <g key={`x-${t}`}>
              <line x1={x} y1={plotBottom} x2={x} y2={plotBottom + 5} />
              <text x={x} y={plotBottom + 18} textAnchor="middle">
                {formatTemperature(t, units)}
              </text>
            </g>
          );
        })}
        <text
          className="axis-title"
          x={(plotLeft + plotRight) / 2}
          y={plotBottom + 40}
          textAnchor="middle"
        >
          Dry-bulb temperature ({LABELS[units].temperature})
        </text>
      </g>

      {/* Humidity ratio axis, on the right — the conventional side */}
      <g className="axis axis-y">
        {yTicks.map((t) => {
          const { y } = scales.project(domain.tdbMin, t.w);
          if (y < plotTop - 0.5 || y > plotBottom + 0.5) return null;
          return (
            <g key={`y-${t.display}`}>
              <line x1={plotRight} y1={y} x2={plotRight + 5} y2={y} />
              <text x={plotRight + 9} y={y} dy="0.32em" textAnchor="start">
                {t.display.toFixed(units === 'IP' ? 0 : 1)}
              </text>
            </g>
          );
        })}
        <text
          className="axis-title"
          transform={`rotate(90 ${plotRight + 42} ${(plotTop + plotBottom) / 2})`}
          x={plotRight + 42}
          y={(plotTop + plotBottom) / 2}
          textAnchor="middle"
        >
          Humidity ratio ({LABELS[units].humidityRatio})
        </text>
      </g>
    </svg>
  );
}
