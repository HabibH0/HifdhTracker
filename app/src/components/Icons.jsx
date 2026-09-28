const paths = {
  home: <><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></>,
  book: <><path d="M12 6.5C10.3 5.2 7.9 4.6 4 4.8v13.4c3.9-.2 6.3.4 8 1.7 1.7-1.3 4.1-1.9 8-1.7V4.8c-3.9-.2-6.3.4-8 1.7Z" /><path d="M12 6.5v13.4" /></>,
  chart: <><path d="M5 20V11M10 20V5M15 20v-7M20 20V8" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  play: <path d="M8 5.5v13l10.5-6.5Z" fill="currentColor" />,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  pages: <><rect x="5" y="3.5" width="12" height="16" rx="1.5" /><path d="M8 7.5h6M8 11h6M8 14.5h4" /><path d="M19.5 7v13.5H9" /></>,
  layers: <><path d="m12 3.5 8.5 4.5L12 12.5 3.5 8Z" /><path d="m3.5 12 8.5 4.5 8.5-4.5" /><path d="m3.5 16 8.5 4.5 8.5-4.5" /></>,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>,
  leaf: <><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14" /><path d="M5 19c3-4 6-6.5 9-8" /></>,
  alert: <><path d="M12 4 2.8 19.5h18.4Z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  flag: <><path d="M5 21V4.5M5 4.5h12l-2 4 2 4H5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  bell: <><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  moon: <path d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10Z" />,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></>,
  upload: <><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14" /></>,
  trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /></>,
  shield: <><path d="M12 3.5 19 6v6c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6Z" /><path d="m9 12 2 2 4-4" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.2" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  list: <><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.8" cy="6.5" r=".6" fill="currentColor" /><circle cx="4.8" cy="12" r=".6" fill="currentColor" /><circle cx="4.8" cy="17.5" r=".6" fill="currentColor" /></>,
  wifiOff: <><path d="M3 3l18 18" /><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.4M19 13a10 10 0 0 0-3.3-2.2M2 9.5a15 15 0 0 1 4.5-2.7M22 9.5a15 15 0 0 0-10-4" /><circle cx="12" cy="19.5" r=".6" fill="currentColor" /></>,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  sparkle: <path d="M12 3.5c.6 4.3 2.2 6 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.5 5.9-2.2 6.5-6.5Z" />,
  edit: <><path d="M4.5 19.5h4l10-10-4-4-10 10Z" /><path d="m13 7 4 4" /></>,
  cloud: <path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.5 4.5 0 0 0 7 18.5Z" />,
  cloudCheck: <><path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.5 4.5 0 0 0 7 18.5Z" /><path d="m9.5 13.5 2 2 3.5-3.5" /></>,
  cloudOff: <><path d="M3 3l18 18" /><path d="M9.5 7.1A6 6 0 0 1 17.6 10.55 4 4 0 0 1 19.8 17M17 18.5H7a4.5 4.5 0 0 1-.9-8.9" /></>,
  cloudUp: <><path d="M7 18.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.5 4.5 0 0 0 7 18.5Z" /><path d="M12 16v-5M9.8 13.2 12 11l2.2 2.2" /></>,
  user: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" /></>,
  logout: <><path d="M14 4.5H6.5v15H14" /><path d="M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 5.6A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.3 6.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.9-.4 4.1-1" /><path d="M9.9 10a3 3 0 0 0 4.1 4.1" /></>,
  history: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" /><path d="M4.5 4.5V9H9" /><path d="M12 8v4l3 2" /></>,
};

export function Icon({ name, size = 22, stroke = 1.8, className, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/** Eight-point star (khātam) — the app's one ornament, used sparingly. */
export function Star({ size = 40, className, style, stroke = 1.2, fill = 'none' }) {
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" className={className} style={style} aria-hidden="true" fill={fill} stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round">
      <rect x="-33" y="-33" width="66" height="66" rx="3" />
      <rect x="-33" y="-33" width="66" height="66" rx="3" transform="rotate(45)" />
    </svg>
  );
}

export function StarPattern({ opacity = 0.06 }) {
  return (
    <svg width="100%" height="100%" aria-hidden="true" style={{ position: 'absolute', inset: 0, opacity, pointerEvents: 'none' }}>
      <defs>
        <pattern id="khatam" width="56" height="56" patternUnits="userSpaceOnUse">
          <g transform="translate(28 28)" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="-14" y="-14" width="28" height="28" />
            <rect x="-14" y="-14" width="28" height="28" transform="rotate(45)" />
            <path d="M-28 -28 -19.8 -19.8M28 -28 19.8 -19.8M-28 28 -19.8 19.8M28 28 19.8 19.8" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#khatam)" />
    </svg>
  );
}
