import { useEffect } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";

/*
 * macOS 26 sheet: a rounded, borderless panel over a lightly dimmed window,
 * with a bold title, right-aligned form labels, and a footer of push buttons
 * below a hairline (destructive on the left, Cancel + default on the right).
 * Metrics are measured from native save/keep sheets.
 */

interface DialogProps {
  title: string;
  message?: ReactNode;
  /** Escape cancels; as with a native sheet, clicks outside it do nothing. */
  onCancel: () => void;
  /** Return in any field triggers this (the default button). */
  onSubmit?: () => void;
  children?: ReactNode;
  footer: ReactNode;
}

export default function Dialog({ title, message, onCancel, onSubmit, children, footer }: DialogProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Portalled to <body> so no ancestor's stacking context can trap the overlay
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4">
      <form
        role="dialog"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
        className="w-full max-w-[400px] rounded-[24px] bg-neutral-900 dark:bg-neutral-800 border border-neutral-700/60 shadow-2xl text-sm text-neutral-100"
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-bold">{title}</h2>
            {message && <p className="text-neutral-100">{message}</p>}
          </div>
          {children}
        </div>
        <div className="flex items-center gap-2 px-5 py-5 border-t border-neutral-700/60">{footer}</div>
      </form>
    </div>,
    document.body,
  );
}

/** A labelled form row: label right-aligned in a fixed column, control beside it. */
export function DialogField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[72px_1fr] items-center gap-2">
      <span className="text-right text-neutral-100">{label}</span>
      <div className="min-w-0">{children}</div>
    </label>
  );
}

export const dialogTextField =
  "w-full h-6 px-1.5 rounded-[6px] bg-neutral-900 border border-neutral-600/70 text-sm text-neutral-100 outline-none focus:border-blue-500 focus:ring-[3px] focus:ring-blue-500/40";

type Variant = "default" | "cancel" | "destructive";

const VARIANTS: Record<Variant, string> = {
  default: "bg-blue-500 text-white active:brightness-90",
  cancel: "bg-neutral-700/70 text-neutral-100 active:bg-neutral-700",
  destructive: "bg-red-900 text-red-500 active:brightness-95",
};

export function DialogButton({
  variant = "cancel",
  className = "",
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  // A disabled default button loses its accent, as in AppKit
  const look = disabled ? "bg-neutral-700/70 text-neutral-500" : VARIANTS[variant];
  return (
    <button
      type={variant === "default" ? "submit" : "button"}
      disabled={disabled}
      className={`h-6 min-w-[74px] px-3 rounded-[6px] text-sm ${look} ${className}`}
      {...rest}
    />
  );
}
