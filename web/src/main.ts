/**
 * Application entry point.
 *
 * Phase 0 ships the calculation engine only — there is no user interface yet.
 * This module exists so the Vite dev server has an entry, and prints the
 * calculation basis so a developer can confirm the vendored library loaded and
 * pinned its unit systems correctly.
 *
 * The chart arrives in Phase 1.
 */
import { CALCULATION_BASIS, CONVERGENCE_TOLERANCE } from './psych/index.js';
import { BRAND, APP_VERSION, DISCLAIMER_SHORT } from './config/branding.js';
import { fromTdbRh } from './psych/index.js';
import { DEFAULTS, humidityRatioToDisplay, enthalpyToDisplay } from './psych/index.js';

const sample = fromTdbRh(75, 0.5, DEFAULTS.IP.standardPressure, 'IP');

const root = document.getElementById('root');
if (root) {
  root.innerHTML = `
    <main style="font-family: system-ui, sans-serif; max-width: 42rem; margin: 0 auto; padding: 3rem 1rem; min-height: 100vh; background: #fff; color: ${BRAND.colours.ink};">
      <h1 style="margin-bottom: 0.25rem;">${BRAND.organisation} ${BRAND.appName}</h1>
      <p style="margin-top: 0; color: #667;">${BRAND.tagline}</p>
      <p><strong>Phase 0</strong> — calculation engine only. No chart yet.</p>
      <h2>Engine check — 75 °F, 50% RH, sea level</h2>
      <ul>
        <li>Humidity ratio: ${humidityRatioToDisplay(sample.w, 'IP').toFixed(1)} gr/lb</li>
        <li>Wet bulb: ${sample.twb.toFixed(2)} °F</li>
        <li>Dew point: ${sample.tdp.toFixed(2)} °F</li>
        <li>Enthalpy: ${enthalpyToDisplay(sample.h, 'IP').toFixed(2)} Btu/lb</li>
        <li>Specific volume: ${sample.v.toFixed(3)} ft³/lb</li>
      </ul>
      <h2>Calculation basis</h2>
      <p>${CALCULATION_BASIS.library} ${CALCULATION_BASIS.version} — ${CALCULATION_BASIS.reference}<br>
         Wet-bulb convergence: ±${CONVERGENCE_TOLERANCE.IP.toFixed(4)} °F / ±${CONVERGENCE_TOLERANCE.SI} °C<br>
         Application version ${APP_VERSION}</p>
      <p style="font-size: 0.85rem; color: #667; border-top: 1px solid #dde; padding-top: 0.75rem;">${DISCLAIMER_SHORT}</p>
    </main>
  `;
}
