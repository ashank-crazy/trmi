import type { ReactNode } from 'react';

/** Five dots, one of them the saboteur. */
export function LogoMark({ large = false }: { large?: boolean }): React.JSX.Element {
  return (
    <span className={large ? 'logo-mark large' : 'logo-mark'} aria-hidden>
      <i />
      <i />
      <i className="odd" />
      <i />
      <i />
    </span>
  );
}

export function LoadingDots(): React.JSX.Element {
  return (
    <span className="loading-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function CheckIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon size={size}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function CopyIcon(): React.JSX.Element {
  return (
    <Icon>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" />
    </Icon>
  );
}

export function LeaveIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M9 16l-4-4 4-4" />
      <path d="M5 12h11" />
    </Icon>
  );
}

export function FlagIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2.5 4.5L17 13H5" />
    </Icon>
  );
}

export function XIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon size={size}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Icon>
  );
}

export function BotIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon size={size}>
      <rect x="4" y="8" width="16" height="12" rx="3.5" />
      <path d="M12 8V4.5" />
      <circle cx="12" cy="3.5" r="1" />
      <path d="M9 13.5v1M15 13.5v1M2 13v3M22 13v3" />
    </Icon>
  );
}

export function BugIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon size={size}>
      <path d="M8 10h8v5a4 4 0 0 1-8 0z" />
      <path d="M9.5 10V8.5a2.5 2.5 0 0 1 5 0V10" />
      <path d="M12 13v6M4 13h4M16 13h4M5 8.5l3 2M19 8.5l-3 2M5 19l3-2M19 19l-3-2" />
    </Icon>
  );
}

export function ShieldIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon size={size}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Icon>
  );
}
