/**
 * Branding and legal text — the single source of truth.
 *
 * Every branded surface reads from here: app chrome, PDF report header and
 * footer, and the stamp applied to PNG, SVG, and CSV exports. The identity
 * below is a **placeholder** pending a decision on whose name this tool
 * carries; swapping or genericising it is a change to this file alone.
 *
 * @see PLAN.md §13 decision 1
 */
import { CALCULATION_BASIS } from '../psych/psychrolib.js';

export const APP_VERSION = '0.1.0';

export const BRAND = {
  organisation: 'Pease Studio',
  /** Sits under the organisation name in the header lockup. */
  strapline: 'Tools for building performance',
  /**
   * The tool's own name.
   *
   * Note: the repository and plan call the project "Psychrometric Studio".
   * Under the Pease Studio identity that lockup reads "Pease Studio
   * Psychrometric Studio", so the *displayed* name is shortened here. The
   * project name in the docs is unchanged; only this string is user-facing.
   */
  appName: 'Psychrometrics',
  tagline: 'Psychrometric analysis, process modelling, and thermal comfort',
  colours: {
    /** Pease Studio greens, taken from the identity artwork. */
    accent: '#0F5F52',
    accentBright: '#3FC98A',
    ink: '#0C2A24',
  },
} as const;

/**
 * Shown in the application and stamped on **every** export.
 *
 * This is not boilerplate. The tool models idealised processes, and at least
 * one of them (desiccant, §4.4) ships as an explicit idealisation. Results are
 * an aid to engineering judgement, not a substitute for it.
 *
 * @see PLAN.md §13 decision 4
 */
export const DISCLAIMER =
  'This tool is provided for engineering analysis and education. All results ' +
  'must be reviewed and independently verified by a qualified engineer before ' +
  'being used for design, procurement, or construction. Calculations follow ' +
  'published ASHRAE formulations and some processes are modelled as ' +
  'idealisations; neither the authors nor the organisation named accept ' +
  'liability for decisions made on the basis of this output.';

/** The short form, for chart corners and CSV headers where space is tight. */
export const DISCLAIMER_SHORT =
  'For engineering analysis and education. Review and independently verify all results.';

/**
 * The provenance block stamped on every export, so any output can be traced
 * to the exact code and calculation basis that produced it.
 */
export interface ProvenanceStamp {
  application: string;
  version: string;
  calculationBasis: string;
  libraryVersion: string;
  generated: string;
  disclaimer: string;
}

export function provenanceStamp(now: Date = new Date()): ProvenanceStamp {
  return {
    application: `${BRAND.organisation} — ${BRAND.appName}`,
    version: APP_VERSION,
    calculationBasis: CALCULATION_BASIS.reference,
    libraryVersion: `${CALCULATION_BASIS.library} ${CALCULATION_BASIS.version}`,
    generated: now.toISOString(),
    disclaimer: DISCLAIMER_SHORT,
  };
}
