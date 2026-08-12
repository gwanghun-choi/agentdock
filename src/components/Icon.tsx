import type { SVGProps } from 'react';

/**
 * Eight inline SVGs, not an icon package.
 *
 * `lucide-react@1.31` was installed and measured first. Every icon it exports
 * imports `dist/esm/Icon.mjs`, which carries `'use client'` — so each icon
 * becomes a client component and ships JavaScript. This application has exactly
 * one client component on purpose (`SubmitForm`, for a pending flag); adding a
 * client runtime so that a magnifier can appear next to a search box inverts
 * that trade for decoration. Four thousand icons were also a large answer to a
 * question about eight.
 *
 * These render on the server, ship no JavaScript, and inherit `currentColor` and
 * font size from whatever styles them. Geometry follows the same 24×24 grid and
 * 2px stroke convention Lucide uses, so swapping to a package later is a
 * find-and-replace rather than a redesign.
 *
 * Always `aria-hidden`. Every one of these sits beside its own text label — the
 * magnifier next to "Search", the arrow next to "Next", the link glyph next to
 * "source on GitHub" — so announcing the icon as well would read the control
 * twice. There is deliberately no `title` prop: an accessible name belongs on
 * the control, not on decoration, and a prop that is never passed is a prop that
 * exists to be misused later.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height="1em"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

/** Used for every GitHub link. The point it must make is "this leaves
 *  AgentDock", which is exactly what this glyph says and what a brand mark
 *  would not. */
export function ExternalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </Svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </Svg>
  );
}

/** The brand mark: a dock, i.e. a container with something docked into it. */
export function DockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <path d="M8 12h8" />
      <path d="M12 8v8" />
    </Svg>
  );
}
