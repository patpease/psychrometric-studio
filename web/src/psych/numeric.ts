/**
 * Root finding.
 *
 * Used wherever a psychrometric quantity must be inverted and PsychroLib
 * provides no closed form — solving for dry bulb from a wet-bulb/RH pair now,
 * and apparatus dew point and comfort-zone boundaries later.
 *
 * Bisection is the default rather than Newton: every function we invert here is
 * monotonic over its physical range but not always cheaply differentiable, and
 * a guaranteed-convergent method that cannot run away is worth more in an
 * engineering tool than a faster one that can.
 */

export interface SolveOptions {
  /** Absolute tolerance on the independent variable. */
  tolerance?: number;
  /** Maximum iterations before giving up. */
  maxIterations?: number;
}

export class ConvergenceError extends Error {
  constructor(
    message: string,
    readonly iterations: number,
    readonly lastValue: number,
  ) {
    super(message);
    this.name = 'ConvergenceError';
  }
}

/**
 * Find `x` in `[lower, upper]` such that `f(x) = 0`, by bisection.
 *
 * Requires a sign change across the bracket. Throws rather than returning a
 * plausible-looking wrong answer when the bracket does not contain a root —
 * silently returning an endpoint is how bad numbers reach reports.
 */
export function bisect(
  f: (x: number) => number,
  lower: number,
  upper: number,
  options: SolveOptions = {},
): number {
  const tolerance = options.tolerance ?? 1e-9;
  const maxIterations = options.maxIterations ?? 200;

  let a = lower;
  let b = upper;
  let fa = f(a);
  const fb = f(b);

  if (fa === 0) return a;
  if (fb === 0) return b;

  if (fa * fb > 0) {
    throw new ConvergenceError(
      `bisect: no sign change over [${lower}, ${upper}] (f(a)=${fa}, f(b)=${fb}); ` +
        'the bracket does not contain a root',
      0,
      Number.NaN,
    );
  }

  let mid = a;
  for (let i = 0; i < maxIterations; i += 1) {
    mid = (a + b) / 2;
    const fm = f(mid);

    if (fm === 0 || (b - a) / 2 < tolerance) return mid;

    if (fa * fm < 0) {
      // Only `fa` is read from here on — the sign test above is against it —
      // so the bracket's upper value is not carried forward.
      b = mid;
    } else {
      a = mid;
      fa = fm;
    }
  }

  throw new ConvergenceError(
    `bisect: failed to converge within ${maxIterations} iterations`,
    maxIterations,
    mid,
  );
}

/**
 * Expand a bracket outward from an initial guess until `f` changes sign, then
 * bisect. For cases where a physically sensible starting point is known but a
 * guaranteed bracket is not.
 */
export function solveExpanding(
  f: (x: number) => number,
  guess: number,
  step: number,
  bounds: readonly [number, number],
  options: SolveOptions = {},
): number {
  const [min, max] = bounds;
  const f0 = f(guess);
  if (f0 === 0) return guess;

  let width = step;
  for (let i = 0; i < 64; i += 1) {
    const lo = Math.max(min, guess - width);
    const hi = Math.min(max, guess + width);

    if (f(lo) * f0 <= 0) return bisect(f, lo, guess, options);
    if (f(hi) * f0 <= 0) return bisect(f, guess, hi, options);

    if (lo === min && hi === max) break;
    width *= 2;
  }

  throw new ConvergenceError(
    `solveExpanding: no sign change found within [${min}, ${max}] from guess ${guess}`,
    64,
    guess,
  );
}

/** Clamp `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
