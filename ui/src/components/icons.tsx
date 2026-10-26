import type { ReactNode } from "react";

const Svg = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const IconPlus = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>;
export const IconClose = ({ size }: { size?: number }) => <Svg size={size}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const IconGlobe = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></Svg>;
export const IconClip = () => <Svg><path d="m20 11-8.6 8.6a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L14.2 7.5" /></Svg>;
export const IconSend = () => <Svg><path d="M12 19V5M5 12l7-7 7 7" /></Svg>;
export const IconExpand = () => <Svg><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Svg>;
export const IconShrink = () => <Svg><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></Svg>;
export const IconMinimize = () => <Svg><path d="M5 12h14" /></Svg>;
export const IconWarn = () => <Svg><path d="M12 4 2.5 20h19L12 4z" /><path d="M12 10v4.5M12 17.5v.01" /></Svg>;
export const IconCheck = () => <Svg size={16}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconLock = () => <Svg><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
export const IconAsk = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17v.01" /></Svg>;
export const IconShield = () => <Svg><path d="M12 3 5 6v5.5c0 4.3 3 7.6 7 9.5 4-1.9 7-5.2 7-9.5V6l-7-3z" /></Svg>;
export const IconChevron = () => <Svg size={18}><path d="m9 6 6 6-6 6" /></Svg>;
export const IconBack = () => <Svg size={18}><path d="m15 6-6 6 6 6" /></Svg>;
export const IconStop = () => <Svg size={16}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></Svg>;
export const IconPanels = () => <Svg><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></Svg>;
export const IconClock = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const IconHistory = () => <Svg><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5v4h4" /><path d="M12 8v4l2.5 1.5" /></Svg>;
export const IconKey = () => <Svg><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M16 7l3 3" /></Svg>;
export const IconGear = () => <Svg><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" /></Svg>;
export const IconVault = () => <Svg><rect x="3.5" y="4" width="17" height="16" rx="3" /><circle cx="12" cy="12" r="3.2" /><path d="M12 8.8V7M12 17v-1.8M8.8 12H7M17 12h-1.8" /></Svg>;
