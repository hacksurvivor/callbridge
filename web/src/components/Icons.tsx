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
