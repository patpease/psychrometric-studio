/**
 * The weather data layer, drawn on a canvas beneath the chart.
 *
 * 8,760 points is roughly a hundred times more nodes than the rest of the chart
 * put together. As SVG elements they pan and zoom visibly badly; on a canvas
 * they cost one pass over a typed array. So the chart is a hybrid — canvas for
 * the data, SVG above it for the furniture and overlays, both driven by the
 * same scales so they cannot drift apart.
 */
import { useEffect, useRef } from 'react';
import type { ChartDomain, ChartMargin } from './scales.js';
import { createScales } from './scales.js';
import type { WeatherHour } from '../weather/epw.js';
import { densityGrid } from '../weather/bins.js';

export type WeatherMode = 'off' | 'scatter' | 'density';

export interface WeatherLayerProps {
  hours: readonly WeatherHour[];
  mode: WeatherMode;
  domain: ChartDomain;
  width: number;
  height: number;
  margin?: ChartMargin;
  /** True when the page is in its dark theme, which the palette follows. */
  dark: boolean;
}

/**
 * Sequential ramp for the density map, low to high.
 *
 * Sequential rather than categorical, because hours-per-cell is an ordered
 * quantity: the reader must be able to tell more from less at a glance. It runs
 * light-to-saturated so that a sparse cell recedes and a dense one advances,
 * and it stops short of the chart's own line colours so a hot cell is never
 * mistaken for a gridline.
 */
const RAMP_LIGHT = ['#e8eef5', '#bcd2e8', '#8fb4d9', '#5f92c7', '#3b6fae', '#22497e'];
const RAMP_DARK = ['#1c2733', '#243d55', '#2c567a', '#3670a1', '#4b8fc4', '#6fb0e0'];

export interface WeatherDrawing {
  readonly hours: readonly WeatherHour[];
  readonly mode: WeatherMode;
  readonly domain: ChartDomain;
  readonly width: number;
  readonly height: number;
  readonly margin?: ChartMargin | undefined;
  readonly dark: boolean;
}

/**
 * Paint the weather layer into a 2D context.
 *
 * Pulled out of the component so that export can re-draw it rather than reuse
 * the pixels on screen. Those pixels carry the viewer's theme, and a report
 * printed from a dark-mode session would arrive with a near-black density map
 * on white paper. Re-drawing costs one pass over a typed array, which is
 * cheaper than the compositing that reusing them would need anyway.
 *
 * The context is assumed to be already scaled to CSS pixels; the caller owns
 * device-pixel ratio, because on screen that is the display's and in an export
 * it is the requested output scale.
 */
export function drawWeather(
  context: CanvasRenderingContext2D,
  { hours, mode, domain, width, height, margin, dark }: WeatherDrawing,
): void {
  context.clearRect(0, 0, width, height);
  if (mode === 'off' || hours.length === 0) return;

  const scales = createScales(domain, width, height, margin);
  const plotLeft = scales.margin.left;
  const plotTop = scales.margin.top;

  // Everything stays inside the plot frame, exactly as the SVG layers do.
  context.save();
  context.beginPath();
  context.rect(plotLeft, plotTop, scales.plotWidth, scales.plotHeight);
  context.clip();

  if (mode === 'scatter') {
    // Semi-transparent dots, so overlapping hours accumulate into visible
    // density rather than flattening into one opaque blob.
    context.fillStyle = dark ? 'rgba(111, 176, 224, 0.35)' : 'rgba(59, 111, 174, 0.28)';
    for (const hour of hours) {
      const { x, y } = scales.project(hour.tdb, hour.w);
      if (x < plotLeft || x > plotLeft + scales.plotWidth) continue;
      if (y < plotTop || y > plotTop + scales.plotHeight) continue;
      context.fillRect(x - 1, y - 1, 2, 2);
    }
  } else {
    const grid = densityGrid(hours, domain);
    const ramp = dark ? RAMP_DARK : RAMP_LIGHT;
    const cellWidth = scales.plotWidth / grid.columns;
    const cellHeight = scales.plotHeight / grid.rows;

    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        const count = grid.counts[row * grid.columns + column]!;
        if (count === 0) continue;

        // Square-root scaling: hours-per-cell is heavily skewed, and a linear
        // ramp leaves everything but the densest few cells indistinguishable.
        const level = Math.sqrt(count / grid.peak);
        const index = Math.min(ramp.length - 1, Math.floor(level * ramp.length));
        context.fillStyle = ramp[index]!;

        const x = plotLeft + column * cellWidth;
        const y = plotTop + scales.plotHeight - (row + 1) * cellHeight;
        // A half-pixel overdraw closes the hairline seams that otherwise show
        // between cells at fractional sizes.
        context.fillRect(x, y, cellWidth + 0.5, cellHeight + 0.5);
      }
    }
  }

  context.restore();
}

export function WeatherLayer({
  hours,
  mode,
  domain,
  width,
  height,
  margin,
  dark,
}: WeatherLayerProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Draw at device resolution so points stay crisp on a retina display; a
    // canvas scaled up by CSS turns 8,760 sharp dots into 8,760 blurs.
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));

    const context = canvas.getContext('2d');
    if (!context) return;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawWeather(context, { hours, mode, domain, width, height, margin, dark });
  }, [hours, mode, domain, width, height, margin, dark]);

  return (
    <canvas
      ref={canvasRef}
      className="weather-layer"
      style={{ width: `${width}px`, height: `${height}px` }}
      aria-hidden="true"
    />
  );
}

/** Legend steps for the density ramp, for the panel. */
export function densityLegend(dark: boolean): string[] {
  return dark ? RAMP_DARK : RAMP_LIGHT;
}
