import React from "react";

interface IconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number | string;
}

const defaultProps = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const Plane = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
  </svg>
);

export const Car = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
    <circle cx="7" cy="17" r="2" />
    <path d="M9 17h6" />
    <circle cx="17" cy="17" r="2" />
  </svg>
);

export const CarFront = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.6 5H8.4a2 2 0 0 0-1.9 1.3L5 10l-2-2" />
    <path d="M7 17h10" />
    <path d="M5 11h14" />
    <rect width="18" height="8" x="3" y="10" rx="2" />
    <circle cx="7" cy="14" r="1" />
    <circle cx="17" cy="14" r="1" />
  </svg>
);

export const Bus = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M8 6v6" />
    <path d="M15 6v6" />
    <path d="M2 12h19.6" />
    <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.6-.4-1-1-1H3c-.6 0-1 .4-1 1 0 .4.1.8.2 1.2l.8 2.8h3" />
    <path d="M4 6V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="18" r="2" />
  </svg>
);

export const Key = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.6 9.6" />
    <path d="m15.5 7.5 3 3L22 7l-3-3" />
  </svg>
);

export const Shield = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
  </svg>
);

export const ShieldCheck = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const Star = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

export const MapPin = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

export const Calendar = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M8 2v4" />
    <path d="M16 2v4" />
    <rect width="18" height="18" x="3" y="4" rx="2" />
    <path d="M3 10h18" />
  </svg>
);

export const Clock = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const Search = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const Columns3 = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <path d="M15 3v18" />
  </svg>
);

export const Columns2 = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M12 3v18" />
  </svg>
);

export const X = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

export const Check = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const Minus = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M5 12h14" />
  </svg>
);

export const Plus = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </svg>
);

export const Trash2 = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    <line x1="10" x2="10" y1="11" y2="17" />
    <line x1="14" x2="14" y1="11" y2="17" />
  </svg>
);

export const ArrowRight = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

export const Eye = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const Info = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);

export const Sparkles = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
  </svg>
);

export const Zap = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

export const ChevronDown = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const ChevronUp = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="m18 15-6-6-6 6" />
  </svg>
);

export const ChevronRight = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const ChevronsUpDown = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="m7 15 5 5 5-5" />
    <path d="m7 9 5-5 5 5" />
  </svg>
);

export const HelpCircle = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
);

export const CreditCard = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <rect width="20" height="14" x="2" y="5" rx="2" />
    <line x1="2" x2="22" y1="10" y2="10" />
  </svg>
);

export const AlertCircle = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" x2="12" y1="8" y2="12" />
    <line x1="12" x2="12.01" y1="16" y2="16" />
  </svg>
);

export const RotateCcw = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

export const Camera = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
);

export const Filter = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

export const SlidersHorizontal = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <line x1="21" x2="14" y1="4" y2="4" />
    <line x1="10" x2="3" y1="4" y2="4" />
    <line x1="21" x2="12" y1="12" y2="12" />
    <line x1="8" x2="3" y1="12" y2="12" />
    <line x1="21" x2="16" y1="20" y2="20" />
    <line x1="12" x2="3" y1="20" y2="20" />
    <line x1="14" x2="14" y1="2" y2="6" />
    <line x1="8" x2="8" y1="10" y2="14" />
    <line x1="16" x2="16" y1="18" y2="22" />
  </svg>
);

export const Phone = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

export const PhoneCall = Phone;

export const Mail = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
);

export const MessageSquare = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export const LayoutDashboard = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />
  </svg>
);

export const Edit3 = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

export const MapIcon = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
    <line x1="9" x2="9" y1="3" y2="18" />
    <line x1="15" x2="15" y1="6" y2="21" />
  </svg>
);

export const List = ({ className, size = 24, ...props }: IconProps) => (
  <svg {...defaultProps} width={size} height={size} className={className} {...props}>
    <line x1="8" x2="21" y1="6" y2="6" />
    <line x1="8" x2="21" y1="12" y2="12" />
    <line x1="8" x2="21" y1="18" y2="18" />
    <line x1="3" x2="3.01" y1="6" y2="6" />
    <line x1="3" x2="3.01" y1="12" y2="12" />
    <line x1="3" x2="3.01" y1="18" y2="18" />
  </svg>
);
