import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary";
type Size = "sm" | "md" | "lg";

// Pill button — DESIGN_SPEC §3.1 (blue primary, never orange in-app).
export function Button({
  variant = "primary",
  size = "md",
  full,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; full?: boolean }) {
  return (
    <button
      className={`btn btn--${variant} btn--${size} ${full ? "btn--full" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "error" | "primary" }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

export function Card({ children, className = "", section, onClick }: { children: ReactNode; className?: string; section?: boolean; onClick?: () => void }) {
  return (
    <div className={`card ${section ? "card--section" : ""} ${onClick ? "card--clickable" : ""} ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}

export function Row({ label, value, valueNode }: { label: string; value?: ReactNode; valueNode?: ReactNode }) {
  return (
    <div className="kv-row">
      <span className="t-body-sm text-alt">{label}</span>
      <span className="t-body-sm-medium tabular">{valueNode ?? value}</span>
    </div>
  );
}
