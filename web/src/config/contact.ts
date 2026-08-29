/**
 * Where feedback goes, and why the address is not written here in plain text.
 *
 * ## The threat
 *
 * Address-harvesting crawlers fetch a page and run two regexes over it: one for
 * `mailto:` hrefs, one for anything shaped like `name@host.tld`. An address
 * that appears in the markup — or as a literal in the JavaScript bundle, which
 * is just as fetchable — is collected within days of going live, and there is
 * no taking it back afterwards.
 *
 * ## What this does about it
 *
 * The two halves are stored ROT13'd and separately, and joined only when
 * someone asks for them. So the bundle contains `crnfrfghqvb` and `tznvy.pbz`,
 * neither of which is an address, and no `@` between them for a pattern to
 * catch. Nothing reaches the DOM until a click: there is no `mailto:` href in
 * the markup for the first regex to find either.
 *
 * ROT13 rather than base64 because base64 is *recognisably* base64 — a crawler
 * that decodes it costs one library call — and rather than string
 * concatenation because a minifier folds `'a' + '@' + 'b'` straight back into
 * the literal it was hiding. `rot13` is a function call over a runtime value,
 * which no minifier will evaluate ahead of time.
 *
 * ## What it does not do
 *
 * **This is a speed bump, not a wall.** A crawler that renders the page and
 * clicks things — and more of them do every year — gets the address anyway. The
 * only way to keep an address off a public page is to not put it there: a form
 * that posts to a server which holds the address as a secret. That is a real
 * option here and is written up in `docs/deploying.md`; it costs a route, an
 * email API key, and a widening of `connect-src`. Until feedback volume or spam
 * justifies it, this buys most of the protection for none of the cost.
 */

/** ROT13 — its own inverse, which is the whole reason it is the one used. */
function rot13(text: string): string {
  return text.replace(/[a-z]/g, (character) =>
    String.fromCharCode(((character.charCodeAt(0) - 97 + 13) % 26) + 97),
  );
}

/** Stored apart so that no substring of the bundle is an email address. */
const LOCAL_PART = 'crnfrfghqvb';
const DOMAIN = 'tznvy.pbz';

/** The feedback address, assembled on demand. */
export function feedbackAddress(): string {
  return `${rot13(LOCAL_PART)}@${rot13(DOMAIN)}`;
}

/**
 * A pre-addressed message, built at the moment it is needed.
 *
 * The subject carries the version because the first question about any report
 * is which build it came from, and the person writing should not have to know
 * to say. The body is a prompt rather than a form: it opens in their own mail
 * client, where they can see and change every word of it before it is sent.
 */
export function feedbackMailto(version: string, units: string): string {
  const subject = `Psychrometric Studio feedback — v${version}`;
  const body = [
    '',
    '',
    '—',
    `Sent from Psychrometric Studio v${version} (${units} units).`,
    'Delete this line if it is not relevant.',
  ].join('\n');

  return (
    `mailto:${feedbackAddress()}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}
