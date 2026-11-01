import type { ReactNode } from 'react';

/** Five dots, one of them odd. */
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

export function CheckIcon(): React.JSX.Element {
  return (
    <Icon>
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

export function CrownIcon(): React.JSX.Element {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 8.5l4.5 3.5L12 5l4.5 7L21 8.5 19 18H5z" />
      <rect x="5" y="19.2" width="14" height="2" rx="1" />
    </svg>
  );
}
