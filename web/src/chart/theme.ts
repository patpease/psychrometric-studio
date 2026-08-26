/**
 * Chart palette.
 *
 * Each line family gets its own hue so that a chart carrying five overlapping
 * families stays readable — the families are not a sequence, so the colours are
 * categorical rather than a ramp. Values are CSS custom properties resolved in
 * `styles.css`, which is what lets the whole chart follow the light/dark theme
 * without the renderer knowing which one is active.
 */
import type { FamilyKey } from './families.js';

export interface FamilyStyle {
  /** CSS custom property holding the stroke colour. */
  readonly colour: string;
  readonly width: number;
  readonly dash?: string;
  /**
   * Where along a line its label sits.
   *
   * `start` and `end` place it just outside the line's first or last point,
   * which is right for families that terminate on the saturation curve — the
   * label sits in open space beside the curve.
   *
   * `fraction` places it *on* the line, partway along, and is right for
   * families whose ends run into the corners of the plot. A relative-humidity
   * curve ends at the top-right boundary, where a label pushed outward is
   * clipped by the plot frame and unreadable.
   */
  readonly labelAt: 'start' | 'end' | 'fraction';
  /** How far along the line, 0–1, when `labelAt` is `fraction`. */
  readonly labelFraction?: number;
  /**
   * Distance in pixels to push the label back along the line, away from its
   * endpoint. Wet-bulb and enthalpy lines both terminate on the saturation
   * curve, so without separating them the two sets of labels overprint. Printed
   * charts solve this the same way: the enthalpy scale sits offset outside the
   * saturation curve, with wet bulb read against the curve itself.
   */
  readonly labelOffset: number;
  readonly displayName: string;
}

export const FAMILY_STYLES: Record<FamilyKey, FamilyStyle> = {
  saturation: {
    colour: 'var(--family-saturation)',
    width: 2.25,
    labelAt: 'end',
    labelOffset: 4,
    displayName: 'Saturation (100% RH)',
  },
  relativeHumidity: {
    colour: 'var(--family-rh)',
    width: 1,
    // On the curve rather than past its end. RH curves sweep into the top-right
    // corner, so an end label lands on or outside the frame and is clipped
    // away. Two-thirds along puts the whole family in a readable arc across the
    // chart, which is also where printed charts carry them.
    labelAt: 'fraction',
    labelFraction: 0.66,
    labelOffset: 0,
    displayName: 'Relative humidity',
  },
  wetBulb: {
    colour: 'var(--family-wetbulb)',
    width: 0.9,
    dash: '4 3',
    // Wet-bulb lines are labelled where they meet the saturation curve, which
    // is how printed charts do it and where the lines are furthest apart.
    labelAt: 'start',
    labelOffset: 5,
    displayName: 'Wet bulb',
  },
  enthalpy: {
    colour: 'var(--family-enthalpy)',
    width: 0.9,
    dash: '6 3',
    labelAt: 'start',
    // Pushed clear of the wet-bulb labels sharing the saturation curve.
    labelOffset: 26,
    displayName: 'Enthalpy',
  },
  specificVolume: {
    colour: 'var(--family-volume)',
    width: 0.9,
    dash: '2 3',
    labelAt: 'end',
    labelOffset: 4,
    displayName: 'Specific volume',
  },
  dewPoint: {
    colour: 'var(--family-dewpoint)',
    width: 0.8,
    dash: '1 4',
    labelAt: 'end',
    labelOffset: 4,
    displayName: 'Dew point',
  },
};

/** Families in the order they should be drawn, back to front. */
export const DRAW_ORDER: FamilyKey[] = [
  'dewPoint',
  'specificVolume',
  'enthalpy',
  'wetBulb',
  'relativeHumidity',
  'saturation',
];

/** Which families are visible by default. */
export const DEFAULT_VISIBILITY: Record<FamilyKey, boolean> = {
  saturation: true,
  relativeHumidity: true,
  wetBulb: true,
  enthalpy: true,
  specificVolume: true,
  dewPoint: false,
};
