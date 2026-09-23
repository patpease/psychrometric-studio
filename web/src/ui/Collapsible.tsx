/**
 * A collapsible panel section.
 *
 * Built on `<details>`/`<summary>` rather than a custom disclosure so it stays
 * keyboard-operable and readable to assistive technology without any ARIA
 * bookkeeping — and so a collapsed section still finds on Ctrl-F in browsers
 * that search closed details.
 */
import type { ReactNode } from 'react';

export interface CollapsibleProps {
  title: string;
  /** Open on first render. Sections the user needs most start open. */
  defaultOpen?: boolean;
  /** A short status shown beside the title, visible while collapsed. */
  badge?: string | undefined;
  /** Names the section for the tab layout, which shows some and hides others. */
  className?: string | undefined;
  children: ReactNode;
}

export function Collapsible({
  title,
  defaultOpen = true,
  badge,
  className,
  children,
}: CollapsibleProps): React.JSX.Element {
  return (
    <details className={className ? `collapsible ${className}` : 'collapsible'} open={defaultOpen}>
      <summary>
        <span className="collapsible-title">{title}</span>
        {badge && <span className="collapsible-badge">{badge}</span>}
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}
