/**
 * The studio footer, as carried by every page on peasestudio.com.
 *
 * Ported rather than imported: these are separate repos and separate deploys,
 * so there is no module to share. The markup and class names are identical to
 * `src/layouts/BaseLayout.astro` in peasestudio-site, and this file is
 * byte-identical in all three tools — the two things that differ between them,
 * the studio name and the palette, are reached through `STUDIO_NAME` and
 * through two custom properties set on `.site-footer` in each tool's CSS.
 *
 * The links live in config/branding.ts beside the rest of the identity, which
 * is the file this family of projects already mirrors tool to tool.
 */
import { FOOTER_LINKS, STUDIO_NAME } from '../config/branding';

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="footer-identity">
        <span className="footer-name">{STUDIO_NAME}</span>
        <span className="footer-year">&copy; {year}</span>
      </div>
      <ul className="footer-links">
        {FOOTER_LINKS.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              data-icon={link.icon}
              rel="me noopener"
              target={link.href.startsWith('mailto:') ? undefined : '_blank'}
            >
              {link.icon === 'coffee' && (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 9h13v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Z" />
                  <path d="M17 10h1.6a2.4 2.4 0 0 1 0 4.8H17" />
                  <path d="M8 3v2.5M12 3v2.5" />
                </svg>
              )}
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </footer>
  );
}
