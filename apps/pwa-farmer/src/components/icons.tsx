/** Inline SVG icons: no icon font or library, to keep the payload small. Decorative unless given a title by the caller. */
import type { ReactNode, SVGProps } from 'react';

const icon = (paths: ReactNode) => function Icon({ size = 28, ...p }: SVGProps<SVGSVGElement> & { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}>{paths}</svg>;
};

export const HomeIcon = icon(<><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>);
export const SproutIcon = icon(<><path d="M12 21v-9" /><path d="M12 12c0-4-3-7-8-7 0 5 3 7 8 7z" /><path d="M12 14c0-3 3-6 8-6 0 5-3 6-8 6z" /><path d="M6 21h12" /></>);
export const ListIcon = icon(<><path d="M9 6h12M9 12h12M9 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>);
export const TruckIcon = icon(<><path d="M2 6h12v11H2z" /><path d="M14 10h4l4 4v3h-8" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>);
export const WalletIcon = icon(<><path d="M3 7a2 2 0 012-2h13v4" /><path d="M3 7v11a2 2 0 002 2h15V9H5a2 2 0 01-2-2z" /><path d="M16 14.5h.01" /></>);
export const GlobeIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9z" /></>);
export const UserIcon = icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>);
export const CameraIcon = icon(<><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13" r="4" /></>);
export const VideoIcon = icon(<><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 11l6-4v10l-6-4" /></>);
export const CheckIcon = icon(<path d="M4 12l5 5L20 6" />);
export const ClockIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const AlertIcon = icon(<><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></>);
export const InfoIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>);
export const PhoneIcon = icon(<path d="M5 3h4l2 5-3 2a12 12 0 006 6l2-3 5 2v4a2 2 0 01-2 2C10 21 3 14 3 5a2 2 0 012-2z" />);
export const BackIcon = icon(<path d="M15 5l-7 7 7 7" />);
export const OfflineIcon = icon(<><path d="M2 2l20 20" /><path d="M5 12a10 10 0 014-2.5M12 8a10 10 0 017 4" /><path d="M8.5 15.5a5 5 0 016 0" /><path d="M12 19h.01" /></>);
export const FileIcon = icon(<><path d="M6 2h8l5 5v15H6z" /><path d="M14 2v5h5" /></>);
export const LocationIcon = icon(<><path d="M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>);
export const ScaleIcon = icon(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 8a5.5 5.5 0 018 0l-2.5 3h-3z" /></>);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const SendIcon = icon(<><path d="M3 11l18-8-8 18-2-8z" /></>);
export const RefreshIcon = icon(<><path d="M20 11a8 8 0 10-2 6" /><path d="M20 5v6h-6" /></>);
export const ChevronIcon = icon(<path d="M9 5l7 7-7 7" />);
export const LogoutIcon = icon(<><path d="M10 4H4v16h6" /><path d="M15 8l4 4-4 4M19 12H9" /></>);
export const StopIcon = icon(<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />);
export const ShieldIcon = icon(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>);
export const TrashIcon = icon(<><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /></>);
