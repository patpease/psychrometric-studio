/**
 * An equipment or process icon.
 *
 * The drawing bodies are compiled into `generated.ts`; this supplies the
 * wrapper. Doing it here rather than in each SVG means sizing, colour, and
 * accessibility are decided once — and an icon with no `title` is marked
 * `aria-hidden`, because an icon that only repeats the text beside it should
 * not be read out twice.
 *
 * `dangerouslySetInnerHTML` is safe here in the way the name asks you to check:
 * the markup is generated at build time from files in this repository, never
 * from user input or from anything fetched at runtime.
 */
import { PENDING_ICONS, iconExists } from './map.js';
import { ICON_SOURCES } from './generated.js';

export interface IconProps {
  name: string;
  size?: number;
  /** An accessible name. Omit when the icon is decorative. */
  title?: string;
  className?: string;
}

export function Icon({ name, size = 24, title, className }: IconProps): React.JSX.Element {
  const body = ICON_SOURCES[name];

  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}${body ? '' : ' icon-pending'}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {body ? (
        <g dangerouslySetInnerHTML={{ __html: body }} />
      ) : (
        // The placeholder is a dashed outline, not a guess at the equipment.
        // It should read as "artwork pending", which is what it is.
        <>
          <title>{title ?? 'Icon not yet drawn'}</title>
          <rect
            x="8"
            y="8"
            width="32"
            height="32"
            rx="4"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeDasharray="4 4"
            opacity="0.45"
          />
        </>
      )}
    </svg>
  );
}

/** Names that will render as placeholders, for the about panel and for tests. */
export function pendingIconNames(): string[] {
  return Object.keys(PENDING_ICONS).filter((name) => !iconExists(name));
}
