/**
 * What this tool is, what it stands on, and what it does not promise.
 *
 * A public engineering calculator owes its user three things it cannot get from
 * the interface alone: where the numbers come from, what the tool will not do
 * for them, and who wrote the code it is built on. All three live here, in the
 * application rather than only in the repository — the deployed page is the
 * distribution most people will ever see.
 */
import { APP_VERSION, BRAND, DISCLAIMER } from '../config/branding.js';
import { CALCULATION_BASIS } from '../psych/psychrolib.js';
import { TMYX_CITATION } from './WeatherPanel.js';

/**
 * Libraries that ship in the bundle.
 *
 * The full notices are generated into `/third-party-notices.txt` at build time
 * from the installed tree. This list is the human-readable summary beside the
 * link, not a second source of truth — if the two disagree, the generated file
 * is right.
 */
const BUNDLED = [
  {
    name: 'PsychroLib',
    version: CALCULATION_BASIS.version,
    licence: 'MIT',
    role: 'Moist-air properties. Every state on the chart comes from here.',
    href: 'https://github.com/psychrometrics/psychrolib',
  },
  {
    name: 'jsthermalcomfort',
    version: '1.4.0',
    licence: 'MIT',
    role: 'ASHRAE 55 PMV/PPD and the adaptive model; a port of pythermalcomfort.',
    href: 'https://github.com/CenterForTheBuiltEnvironment/jsthermalcomfort',
  },
  {
    name: 'fflate',
    version: '0.8.3',
    licence: 'MIT',
    role: 'Opens zipped weather archives, and compresses projects into share links.',
    href: 'https://github.com/101arrowz/fflate',
  },
  {
    name: 'React',
    version: '19',
    licence: 'MIT',
    role: 'The interface.',
    href: 'https://react.dev',
  },
] as const;

export function AboutPanel(): React.JSX.Element {
  return (
    <section className="about-panel">
      <p className="edu-text">
        A psychrometric chart that solves an air-handling chain, checks it
        against ASHRAE 55 comfort, and counts a year of weather against it.
        Everything is computed in your browser: no account, no upload, and
        nothing kept after you close the tab.
      </p>

      <h4>Calculation basis</h4>
      <dl className="readout">
        <dt>Library</dt>
        <dd>
          {CALCULATION_BASIS.library} {CALCULATION_BASIS.version}
        </dd>
        <dt>Reference</dt>
        <dd>{CALCULATION_BASIS.reference}</dd>
        <dt>Application</dt>
        <dd>
          {BRAND.appName} {APP_VERSION}
        </dd>
      </dl>
      <p className="comfort-note">
        The vendored copy of the library is checked against a recorded SHA-256 in
        CI, so the basis stamped on an export cannot drift from the code that
        produced it.
      </p>

      <h4>What it does not do</h4>
      <p className="edu-check">
        It models idealised processes. A desiccant wheel is treated as
        isenthalpic and carries no regeneration airstream; coil bypass factors
        are yours to supply rather than selections; nothing here replaces a
        manufacturer&rsquo;s rating at your conditions.
      </p>

      <h4>Built on</h4>
      <ul className="about-list">
        {BUNDLED.map((item) => (
          <li key={item.name}>
            <a href={item.href} target="_blank" rel="noreferrer noopener">
              {item.name} {item.version}
            </a>
            <span className="about-licence">{item.licence}</span>
            <span className="about-role">{item.role}</span>
          </li>
        ))}
      </ul>
      <p className="comfort-note">
        Full copyright and permission notices:{' '}
        <a href="/third-party-notices.txt" target="_blank" rel="noreferrer noopener">
          third-party notices
        </a>
        . ASHRAE standards are copyrighted; this tool implements published
        equations and reproduces neither tables nor text.
      </p>

      <h4>Weather data</h4>
      <p className="citation">{TMYX_CITATION}</p>

      <h4>Disclaimer</h4>
      <p className="disclaimer">{DISCLAIMER}</p>
    </section>
  );
}
