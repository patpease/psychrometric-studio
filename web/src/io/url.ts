/**
 * Putting a project in a link.
 *
 * The whole project goes in the URL **fragment**, deflated and base64url'd. The
 * fragment is the right half of the URL for this: browsers never send it to a
 * server, so pasting a link into a chat window does not hand someone's design
 * to an analytics log on the way past. The tool has no accounts and no storage,
 * and a share feature that quietly acquired both would be a different product.
 *
 * ## The length limit
 *
 * There is no single number. Browsers accept fragments far longer than anything
 * this format produces; what actually breaks is everything in between — mail
 * clients wrapping at 998 characters, chat apps truncating their previews, old
 * proxies capping the request line at 8 KB even though the fragment never
 * reaches them.
 *
 * So the cap here is a *usability* limit, not a technical one, and it is set
 * where links stop surviving being sent to someone. Above it the tool says so
 * and offers the project file instead, which is the honest answer: a weather
 * file is 1.5 MB and no amount of compression puts it in a link.
 *
 * Compression is `fflate`, already a dependency for reading zipped EPW
 * archives, so this adds nothing to the bundle.
 */
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import type { Project } from '../types/project.js';
import { readProject, writeProject, type LoadResult } from './project.js';

/**
 * Longest link this tool will hand out.
 *
 * Chosen to clear the 2,048 characters that the most restrictive things in
 * common use still assume, with room for the origin and path in front of it.
 */
export const MAX_URL_LENGTH = 2000;

/** The fragment key, so a share link is self-describing when read by a human. */
const KEY = 'p';

/* -------------------------------------------------------------------------- *
 * base64url
 * -------------------------------------------------------------------------- */

/**
 * Standard base64 is not URL-safe: `+` and `/` are meaningful in a URL and `=`
 * invites over-eager trimming. base64url swaps the first two and drops the
 * padding, which is recoverable from the length.
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: spreading a large array into String.fromCharCode blows the
  // argument limit somewhere around a hundred thousand bytes.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* -------------------------------------------------------------------------- *
 * Encoding
 * -------------------------------------------------------------------------- */

export function encodeProject(project: Project): string {
  // Compact, not indented: the pretty-printing that makes a downloaded file
  // readable is pure weight here, and deflate does not fully recover it.
  return toBase64Url(deflateSync(strToU8(JSON.stringify(project)), { level: 9 }));
}

export interface ShareLink {
  readonly url: string;
  readonly length: number;
  /** False when the link is too long to survive being sent to someone. */
  readonly usable: boolean;
  /** What to tell the user when it is not usable. */
  readonly reason?: string;
}

export function shareLink(project: Project, base: string): ShareLink {
  const encoded = encodeProject(project);
  const origin = base.split('#')[0] ?? base;
  const url = `${origin}#${KEY}=${encoded}`;

  if (url.length <= MAX_URL_LENGTH) {
    return { url, length: url.length, usable: true };
  }

  return {
    url,
    length: url.length,
    usable: false,
    reason:
      `This project encodes to ${url.length.toLocaleString()} characters, past the ` +
      `${MAX_URL_LENGTH.toLocaleString()} a link reliably survives being emailed or ` +
      'pasted into a chat. Download the project file instead — it carries exactly ' +
      'the same information.',
  };
}

/* -------------------------------------------------------------------------- *
 * Decoding
 * -------------------------------------------------------------------------- */

/**
 * Read a project out of a URL fragment, if there is one.
 *
 * Returns `null` when the fragment holds no project, which is the ordinary
 * case. A fragment that *claims* to hold one and cannot be read returns a
 * failed `LoadResult` rather than null, because silently opening an empty tool
 * after someone followed a share link is the worst of the available outcomes.
 */
export function readFragment(fragment: string): LoadResult | null {
  const cleaned = fragment.replace(/^#/, '');
  if (!cleaned) return null;

  const params = new URLSearchParams(cleaned);
  const encoded = params.get(KEY);
  if (!encoded) return null;

  try {
    const json = strFromU8(inflateSync(fromBase64Url(encoded)));
    return readProject(json);
  } catch {
    return {
      project: null,
      migrated: [],
      problems: [
        'This link carries a project, but it could not be unpacked. It may have ' +
          'been shortened, wrapped by an email client, or truncated on the way here — ' +
          'ask for the project file instead.',
      ],
    };
  }
}

/** Round-trip helper, used by the tests and by nothing else. */
export function decodeProject(encoded: string): LoadResult {
  return readProject(strFromU8(inflateSync(fromBase64Url(encoded))));
}

export { writeProject };
