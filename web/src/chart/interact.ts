/**
 * Chart interaction: hover readout, wheel zoom, and drag pan — and on a touch
 * screen, the same three as a phone's map does them: one finger pans, two
 * pinch to zoom, and a tap pins the reading at that spot.
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
  pinchDomain,
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
  onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: (event: React.PointerEvent<HTMLDivElement>) => void;
  /** Clear a reading pinned by a tap. */
  clearHover: () => void;
}

/** A touch that travels further than this is a pan, not a tap. */
const TAP_SLOP = 8;
/** And one held longer than this is a press, not a tap. */
const TAP_MS = 500;

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

  /*
   * Touch state. A mouse has one pointer and a hover; a hand has several
   * pointers and none, so the readout cannot follow a finger that is also
   * panning. It is pinned by a tap instead and stays until the next one.
   */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ domain: ChartDomain; focus: DataPoint; distance: number } | null>(null);
  const tap = useRef<{ x: number; y: number; at: number; moved: boolean; onPoint?: boolean } | null>(null);

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

  /**
   * The air at a pointer, or null off the chart or above saturation — where
   * there is no air to describe, and a clamped state would report properties
   * for a condition the pointer is not actually over.
   */
  const stateAt = useCallback(
    (event: { clientX: number; clientY: number }): MoistAirState | null => {
      const point = pointerToData(event);
      if (!point) return null;
      const wSat = saturationHumidityRatio(point.tdb, pressure, units);
      if (point.w > wSat || point.w < 0) return null;
      try {
        return solveState(point.tdb, point.w, pressure, units);
      } catch {
        return null;
      }
    },
    [pointerToData, pressure, units],
  );

  /** Two touches' separation and midpoint, the midpoint relative to the chart. */
  const spread = useCallback(() => {
    const [a, b] = [...touches.current.values()];
    const rect = containerRef.current?.getBoundingClientRect();
    if (!a || !b || !rect) return null;
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top },
    };
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch') {
        if (!touches.current.has(event.pointerId)) return;
        touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        const pinching = pinch.current;
        if (pinching && touches.current.size >= 2) {
          const now = spread();
          if (!now) return;
          const { limits: limitsNow, width: w, height: h } = latest.current;
          latest.current.onDomainChange(() =>
            pinchDomain(pinching.domain, pinching.focus, pinching.distance, now.distance, now.mid, w, h, limitsNow),
          );
          return;
        }

        const started = tap.current;
        if (started && Math.hypot(event.clientX - started.x, event.clientY - started.y) > TAP_SLOP) {
          started.moved = true;
        }
        // Falls through to the pan below. A finger has no hover to update.
        if (!dragOrigin.current || !started?.moved) return;
      }

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

      setHover(stateAt(event));
    },
    [stateAt, spread],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch') {
        // No explicit capture. A touch is already captured to whatever it
        // landed on, and its moves still bubble here; capturing it to the pane
        // instead retargets the click, so a tap on a state point would select
        // nothing.
        touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

        if (touches.current.size === 2) {
          // A second finger turns a pan into a pinch, and is never a tap.
          tap.current = null;
          dragOrigin.current = null;
          const now = spread();
          const scales = createScales(latest.current.domain, latest.current.width, latest.current.height);
          if (now) {
            pinch.current = {
              domain: latest.current.domain,
              focus: scales.invert(now.mid.x, now.mid.y),
              distance: now.distance,
            };
          }
          return;
        }
        if (touches.current.size > 2) return;

        tap.current = {
          x: event.clientX,
          y: event.clientY,
          at: Date.now(),
          moved: false,
          // A tap on a state point selects it (ProcessOverlay's click); it is
          // not also a request to read the air there.
          onPoint: event.target instanceof Element && event.target.closest('.process-point') !== null,
        };
        const point = pointerToData(event);
        if (point) {
          dragOrigin.current = { point, domain: latest.current.domain };
          setPanning(true);
        }
        return;
      }

      const point = pointerToData(event);
      if (!point) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragOrigin.current = { point, domain: latest.current.domain };
      setPanning(true);
    },
    [pointerToData, spread],
  );

  const release = (event: React.PointerEvent<HTMLDivElement>): void => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* nothing to release */
    }
  };

  const endTouch = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const started = tap.current;
      const wasTap =
        !cancelled &&
        started !== null &&
        !started.moved &&
        touches.current.size === 1 &&
        Date.now() - started.at < TAP_MS;

      touches.current.delete(event.pointerId);
      release(event);

      // A tap pins the reading where it landed, or clears it when it landed
      // somewhere with no air to describe.
      if (wasTap && !started.onPoint) setHover(stateAt(event));

      if (touches.current.size === 1) {
        // One finger lifted from a pinch: the other carries on as a pan from
        // wherever it is now, rather than jumping back to where it started.
        pinch.current = null;
        const [remaining] = [...touches.current.values()];
        const point = remaining ? pointerToData({ clientX: remaining.x, clientY: remaining.y }) : null;
        dragOrigin.current = point ? { point, domain: latest.current.domain } : null;
        // Already moving, so lifting it later is the end of a pan, not a tap.
        tap.current = remaining ? { ...remaining, at: 0, moved: true } : null;
        return;
      }
      if (touches.current.size === 0) {
        pinch.current = null;
        tap.current = null;
        dragOrigin.current = null;
        setPanning(false);
      }
    },
    [pointerToData, stateAt],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch') {
        endTouch(event, false);
        return;
      }
      release(event);
      dragOrigin.current = null;
      setPanning(false);
    },
    [endTouch],
  );

  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch') {
        endTouch(event, true);
        return;
      }
      release(event);
      dragOrigin.current = null;
      setPanning(false);
    },
    [endTouch],
  );

  // A mouse leaving takes its reading with it. A finger always "leaves" when
  // it lifts, and a reading pinned by a tap has to outlive that.
  const onPointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') setHover(null);
  }, []);

  const clearHover = useCallback(() => setHover(null), []);

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
    onPointerCancel,
    onPointerLeave,
    clearHover,
  };
}
