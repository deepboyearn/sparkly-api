import React from "react";

/* ─── Button ─────────────────────────────────────────────────────────────── */

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  onPress?: () => void;
}

export function Button({
  variant = "primary",
  className = "",
  onPress,
  onClick,
  children,
  ...props
}: ButtonProps) {
  const variantClass =
    variant === "ghost"
      ? "sparkly-btn-ghost"
      : variant === "danger"
        ? "sparkly-btn-danger"
        : "sparkly-btn-primary";

  return (
    <button
      className={`sparkly-btn ${variantClass} ${className}`}
      onClick={onPress ?? onClick}
      {...props}
    >
      {children}
    </button>
  );
}

/* ─── Card ───────────────────────────────────────────────────────────────── */

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

function CardRoot({ className = "", children, ...props }: CardProps) {
  return (
    <div className={`sparkly-card ${className}`} {...props}>
      {children}
    </div>
  );
}

interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

function CardContent({ className = "", children, ...props }: CardContentProps) {
  return (
    <div className={`sparkly-card-content ${className}`} {...props}>
      {children}
    </div>
  );
}

export const Card = Object.assign(CardRoot, { Content: CardContent });

/* ─── Input ──────────────────────────────────────────────────────────────── */

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className = "", ...props }: InputProps) {
  return (
    <input className={`sparkly-input ${className}`} {...props} />
  );
}

/* ─── Alert ──────────────────────────────────────────────────────────────── */

interface AlertProps {
  status?: "danger" | "success" | "warning" | "info";
  title?: string;
  className?: string;
  children?: React.ReactNode;
}

export function Alert({ status = "info", title, className = "", children }: AlertProps) {
  const statusClass =
    status === "danger"
      ? "sparkly-alert-danger"
      : status === "success"
        ? "sparkly-alert-success"
        : status === "warning"
          ? "sparkly-alert-warning"
          : "sparkly-alert-info";

  return (
    <div className={`sparkly-alert ${statusClass} ${className}`} role="alert">
      {title && <strong>{title}</strong>}
      {children && <span>{children}</span>}
    </div>
  );
}

/* ─── Chip ───────────────────────────────────────────────────────────────── */

interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

export function Chip({ className = "", children, ...props }: ChipProps) {
  return (
    <span className={`sparkly-chip ${className}`} {...props}>
      {children}
    </span>
  );
}

/* ─── Select ─────────────────────────────────────────────────────────────── */

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
}

interface SelectProps<T extends string = string> {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
}

export function Select<T extends string = string>({
  options,
  value,
  onChange,
  placeholder = "Select...",
  className = "",
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={`account-picker-container ${className}`}>
      <button
        type="button"
        className={`account-picker-trigger ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span>{selectedOption ? selectedOption.label : placeholder}</span>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--muted)", transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "none" }}>
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>

      {isOpen && (
        <div className="account-picker-dropdown">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`account-picker-item ${isSelected ? "selected" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                <div>
                  <div style={{ fontWeight: isSelected ? "700" : "500" }}>{option.label}</div>
                  {option.description && (
                    <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                      {option.description}
                    </div>
                  )}
                </div>
                {isSelected && (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
