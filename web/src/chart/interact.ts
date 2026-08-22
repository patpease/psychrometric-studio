/**
 * Chart interaction: hover readout, wheel zoom, and drag pan.
 *
 * All three are expressed as changes to the chart *domain* rather than as a
 * transform applied over a fixed rendering. That costs a re-tessellation on
 * every zoom step, and buys the thing that matters: gridlines stay smooth at
 * any magnification instead of turning into visible polylines.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createScales,
  panDomain,
  zoomDomain,
  type ChartDomain,
  type DataPoint,
} from './scales.js';
import { solveState, saturationHumidityRatio, type MoistAirState } from '../psych/state.js';
import type { UnitSystem } from '../psych/units.js';

export interface UseChartInteractionOptions {
  domain: ChartDomain;
  limits: ChartDomain;
  pressure: number;
  units: UnitSystem;
  width: number;
  height: number;
  /**
   * Takes an updater rather than a value.
   *
   * Several wheel events can arrive within a single task, and a value-based
   * callback would compute all of them from the same stale domain — eight
   * clicks of the wheel would advance the zoom by one step. The updater form
   * lets React apply them in sequence.
   */
  onDomainChange: (update: (current: ChartDomain) => ChartDomain) => void;
}

export interface ChartInteraction {
  /** The solved state under the cursor, or null when off-chart. */
  hover: MoistAirState | null;
  /** True while the user is dragging to pan. */
  panning: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
}

export function useChartInteraction({
  domain,
  limits,
  pressure,
  units,
  width,
  height,
  onDomainChange,
}: UseChartInteractionOptions): ChartInteraction {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<MoistAirState | null>(null);
  const [panning, setPanning] = useState(false);
  const dragOrigin = useRef<{ point: DataPoint; domain: ChartDomain } | null>(null);

  // Kept in refs so the non-passive wheel listener below always sees current
  // values without being torn down and rebuilt on every domain change.
  const latest = useRef({ domain, limits, width, height, onDomainChange });
  latest.current = { domain, limits, width, height, onDomainChange };

  const pointerToData = useCallback(
    (event: { clientX: number; clientY: number }): DataPoint | null => {
      const element = containerRef.current;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const scales = createScales(latest.current.domain, latest.current.width, latest.current.height);
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (!scales.containsPixel(x, y)) return null;
      return scales.invert(x, y);
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragOrigin.current;

      if (drag) {
        const element = containerRef.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const scales = createScales(drag.domain, latest.current.width, latest.current.height);
        const current = scales.invert(event.clientX - rect.left, event.clientY - rect.top);

        // Move the domain opposite to the pointer so the grabbed condition
        // stays under the cursor. Panning measures from the domain captured at
        // pointer-down, so it is already immune to the batching problem above.
        const limitsNow = latest.current.limits;
        const deltaTdb = drag.point.tdb - current.tdb;
        const deltaW = drag.point.w - current.w;
        latest.current.onDomainChange(() =>
          panDomain(drag.domain, deltaTdb, deltaW, limitsNow),
        );
        return;
      }

      const point = pointerToData(event);
      if (!point) {
        setHover(null);
        return;
      }

      // Above the saturation curve there is no air to describe. Reporting a
      // clamped state here would silently show properties for a condition the
      // cursor is not actually over.
      const wSat = saturationHumidityRatio(point.tdb, pressure, units);
      if (point.w > wSat || point.w < 0) {
        setHover(null);
        return;
      }

      try {
        setHover(solveState(point.tdb, point.w, pressure, units));
      } catch {
        setHover(null);
      }
    },
    [pointerToData, pressure, units],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const point = pointerToData(event);
      if (!point) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragOrigin.current = { point, domain: latest.current.domain };
      setPanning(true);
    },
    [pointerToData],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragOrigin.current = null;
    setPanning(false);
  }, []);

  const onPointerLeave = useCallback(() => {
    setHover(null);
  }, []);

  /**
   * Discard the hover state when the unit system or site pressure changes.
   *
   * A solved state belongs to the unit system it was solved in — its enthalpy
   * is Btu/lb or J/kg, not a neutral number. Keeping a stale state across a
   * unit switch renders IP values through SI formatters, which produced
   * readings like "0.03 kJ/kg" and "13.85 m³/kg": not merely stale, but
   * confidently wrong in a way an engineer would notice and distrust.
   *
   * The cursor has not moved, so there is no correct value to show — the honest
   * result is no reading until the pointer moves again.
   */
  useEffect(() => {
    setHover(null);
  }, [units, pressure]);

  /**
   * Wheel zoom is attached imperatively because React's synthetic wheel handler
   * is passive — `preventDefault` there is ignored, and the page scrolls behind
   * the chart while the user is trying to zoom it.
   */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const handleWheel = (event: WheelEvent): void => {
      const rect = element.getBoundingClientRect();
      const { limits: currentLimits, width: w, height: h } = latest.current;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (!createScales(latest.current.domain, w, h).containsPixel(x, y)) return;

      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12;

      // The focus point is resolved against whichever domain is current when
      // this update runs, not the one captured at event time — so a burst of
      // wheel events zooms smoothly about the cursor instead of collapsing.
      latest.current.onDomainChange((currentDomain) => {
        const focus = createScales(currentDomain, w, h).invert(x, y);
        return zoomDomain(currentDomain, factor, focus, currentLimits);
      });
    };

    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  return {
    hover,
    panning,
    containerRef,
    onPointerMove,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
  };
}
