/**
 * Collect the licence text of everything that ships in the bundle.
 *
 * The front end bundles four MIT libraries plus a vendored fifth. MIT requires
 * that its copyright and permission notice travel with the distribution, and a
 * minified bundle strips comments — so the notice has to be shipped alongside
 * it deliberately. This generates that file from the actual dependency tree
 * rather than from a list someone maintains by hand, because a hand-maintained
 * list is wrong the first time a dependency is added.
 *
 * Only **runtime** dependencies are collected. Build and test tooling does not
 * reach the user and does not need attributing to them.
 *
 * Run: npm run build:notices
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outFile = join(root, '..', 'THIRD-PARTY-NOTICES.md');
/**
 * A second copy, served by the application.
 *
 * A notice file that exists only in the repository does not reach anyone using
 * the deployed tool, which is the distribution the licences are about. The
 * About panel links to this one.
 */
const servedFile = join(root, 'public', 'third-party-notices.txt');

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** Candidate filenames, in the order they are usually found. */
const LICENCE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING'];

function licenceText(packageDir) {
  let names;
  try {
    names = readdirSync(packageDir);
  } catch {
    return null;
  }
  for (const candidate of LICENCE_FILES) {
    const match = names.find((name) => name.toLowerCase() === candidate.toLowerCase());
    if (match) return readFileSync(join(packageDir, match), 'utf8').trim();
  }
  return null;
}

const entries = [];

for (const name of Object.keys(manifest.dependencies ?? {})) {
  // The vendored library lives in the repository, not in node_modules, and
  // carries its licence beside the source it was taken from.
  const directory =
    name === 'psychrolib-vendored' ? join(root, 'vendor') : join(root, 'node_modules', name);

  let version = '';
  try {
    version = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version ?? '';
  } catch {
    /* the vendored package declares its own version below */
  }

  const text =
    name === 'psychrolib-vendored'
      ? readFileSync(join(root, 'vendor', 'psychrolib.LICENSE.txt'), 'utf8').trim()
      : licenceText(directory);

  if (!text) {
    throw new Error(
      `No licence file found for ${name}. It ships in the bundle, so its notice ` +
        'must ship too — find the licence and add its filename to LICENCE_FILES.',
    );
  }

  entries.push({ name, version, text });
}

entries.sort((a, b) => a.name.localeCompare(b.name));

const body = `# Third-party notices

Psychrometric Studio bundles the libraries below into the JavaScript it serves.
Each is reproduced here with its copyright and permission notice, as its licence
requires. A minified bundle strips comments, so this file is how those notices
reach you.

**This file is generated** by \`web/scripts/collect-licences.mjs\` from the
installed dependency tree. Run \`npm run build:notices\` after changing a runtime
dependency; do not edit it by hand.

ASHRAE standards are copyrighted. This project implements published equations
and reproduces neither the tables nor the text of any standard.

${entries
  .map(
    (entry) =>
      `---\n\n## ${entry.name}${entry.version ? ` ${entry.version}` : ''}\n\n\`\`\`\n${entry.text}\n\`\`\`\n`,
  )
  .join('\n')}`;

writeFileSync(outFile, body, 'utf8');
writeFileSync(servedFile, body, 'utf8');
console.log(`Wrote notices for ${entries.length} bundled packages, and served a copy.`);
