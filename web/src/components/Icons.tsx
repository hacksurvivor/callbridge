import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export function CallBridgeIcon(props: IconProps) {
  return <Icon {...props}><rect x="6.5" y="4" width="7" height="12" rx="1.4" /><path d="M8.7 7.1h2.6M8.7 9.8h2.6M8.7 12.5h2.6" /></Icon>;
}

export function DestinationIcon(props: IconProps) {
  return <Icon {...props}><path d="M10 17s5-4.4 5-9A5 5 0 0 0 5 8c0 4.6 5 9 5 9Z" /><circle cx="10" cy="8" r="1.7" /></Icon>;
}

export function CheckIcon(props: IconProps) {
  return <Icon {...props}><path d="m5.6 10.2 2.6 2.6 6.2-6.2" /></Icon>;
}

export function CrossIcon(props: IconProps) {
  return <Icon {...props}><path d="m6.2 6.2 7.6 7.6M13.8 6.2l-7.6 7.6" /></Icon>;
}

export function ShieldIcon(props: IconProps) {
  return <Icon {...props}><path d="M10 2.9 15 5v3.8c0 3.4-2.1 6.4-5 7.7-2.9-1.3-5-4.3-5-7.7V5l5-2.1Z" /></Icon>;
}

export function LockIcon(props: IconProps) {
  return <Icon {...props}><rect x="5.5" y="8.4" width="9" height="7" rx="1.5" /><path d="M7.5 8.4V6.5a2.5 2.5 0 0 1 5 0v1.9" /></Icon>;
}

export function PlusIcon(props: IconProps) {
  return <Icon {...props}><path d="M10 4v12M4 10h12" /></Icon>;
}

export function SearchIcon(props: IconProps) {
  return <Icon {...props}><circle cx="8.7" cy="8.7" r="4.8" /><path d="m12.3 12.3 3.6 3.6" /></Icon>;
}

export function GalleryIcon(props: IconProps) {
  return <Icon {...props}><rect x="3" y="4" width="14" height="12" rx="2" /><circle cx="7" cy="8" r="1.2" /><path d="m5 14 3.4-3.4 2.3 2.2 1.6-1.6L15 14" /></Icon>;
}

export function ActivityIcon(props: IconProps) {
  return <Icon {...props}><path d="M3 10h3l1.7-4 3.1 8 1.8-4H17" /></Icon>;
}

export function PaperclipIcon(props: IconProps) {
  return <Icon {...props}><path d="m7.2 10.7 4.9-4.9a2.5 2.5 0 0 1 3.6 3.6L9 16.1a4 4 0 0 1-5.7-5.7l6.2-6.2a2.4 2.4 0 0 1 3.4 3.4L7 13.5a.9.9 0 0 1-1.3-1.3l5.4-5.4" /></Icon>;
}

export function MicrophoneIcon(props: IconProps) {
  return <Icon {...props}><rect x="7" y="3" width="6" height="10" rx="3" /><path d="M4.8 9.5a5.2 5.2 0 0 0 10.4 0M10 14.7V17" /></Icon>;
}

export function SendIcon(props: IconProps) {
  return <Icon {...props}><path d="m3 9.4 14-6-5.2 13.6-2.2-5.3L3 9.4Z" /><path d="m9.6 11.7 3.6-4" /></Icon>;
}

export function ArrowUpIcon(props: IconProps) {
  return <Icon {...props}><path d="M10 16V4M5.5 8.5 10 4l4.5 4.5" /></Icon>;
}

export function ChevronIcon(props: IconProps) {
  return <Icon {...props}><path d="m7 5 5 5-5 5" /></Icon>;
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon {...props}><path d="m5 7.5 5 5 5-5" /></Icon>;
}

export function MoreIcon(props: IconProps) {
  return <Icon {...props}><circle cx="5" cy="10" r=".8" fill="currentColor" stroke="none" /><circle cx="10" cy="10" r=".8" fill="currentColor" stroke="none" /><circle cx="15" cy="10" r=".8" fill="currentColor" stroke="none" /></Icon>;
}

export function ThemeIcon(props: IconProps) {
  return <Icon {...props}><path d="M14.7 12.9A6.2 6.2 0 0 1 7.1 5.3a6.3 6.3 0 1 0 7.6 7.6Z" /></Icon>;
}

export function CloseIcon(props: IconProps) {
  return <Icon {...props}><path d="m5 5 10 10M15 5 5 15" /></Icon>;
}

export function ToolIcon(props: IconProps) {
  return <Icon {...props}><path d="M12.5 4.1a4.2 4.2 0 0 0-5.3 5.3l-3.7 3.7a2 2 0 1 0 2.8 2.8l3.7-3.7a4.2 4.2 0 0 0 5.3-5.3l-2.5 2.5-2.2-.6-.6-2.2 2.5-2.5Z" /></Icon>;
}

export function MenuIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 6h12M4 10h12M4 14h12" /></Icon>;
}

export function StopIcon(props: IconProps) {
  return <Icon {...props}><rect x="5.5" y="5.5" width="9" height="9" rx="1" /></Icon>;
}
