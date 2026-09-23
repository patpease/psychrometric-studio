/**
 * The tab bar, below 860px.
 *
 * Four screens, because a phone shows one thing at a time and the tool is
 * four things: the system being designed, the chart it draws, the numbers it
 * solves to, and everything else. The order is the order of the work.
 *
 * The screens are the desk's own panels shown one at a time (see the tab
 * layout in styles.css), so switching tabs unmounts nothing — a half-typed
 * field or an open section is where it was left.
 */
export type MobileTab = 'system' | 'chart' | 'results' | 'more';

const TABS: readonly { id: MobileTab; label: string; glyph: React.JSX.Element }[] = [
  {
    id: 'system',
    label: 'System',
    // Three components in a chain.
    glyph: (
      <>
        <rect x="2.5" y="8.5" width="5" height="7" rx="1" />
        <rect x="9.5" y="8.5" width="5" height="7" rx="1" />
        <rect x="16.5" y="8.5" width="5" height="7" rx="1" />
        <path d="M7.5 12h2M14.5 12h2" />
      </>
    ),
  },
  {
    id: 'chart',
    label: 'Chart',
    // The saturation curve over its axes.
    glyph: (
      <>
        <path d="M3.5 3.5v17h17" />
        <path d="M5 19c4-.5 8-3 10.5-6.5S19 5.5 19.5 3.5" />
        <path d="M9 20.5V14M13 20.5v-8" strokeDasharray="1.5 2" />
      </>
    ),
  },
  {
    id: 'results',
    label: 'Results',
    // A table.
    glyph: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
        <path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15" />
      </>
    ),
  },
  {
    id: 'more',
    label: 'More',
    glyph: (
      <>
        <circle cx="6" cy="12" r="1.3" fill="currentColor" />
        <circle cx="12" cy="12" r="1.3" fill="currentColor" />
        <circle cx="18" cy="12" r="1.3" fill="currentColor" />
      </>
    ),
  },
];

export function TabBar({
  tab,
  onTab,
}: {
  tab: MobileTab;
  onTab: (tab: MobileTab) => void;
}): React.JSX.Element {
  return (
    <nav className="tabbar" aria-label="Screens">
      {TABS.map(({ id, label, glyph }) => (
        <button
          key={id}
          type="button"
          onClick={() => onTab(id)}
          aria-current={tab === id ? 'page' : undefined}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {glyph}
          </svg>
          {label}
        </button>
      ))}
    </nav>
  );
}
