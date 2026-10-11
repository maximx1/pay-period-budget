import { CircleAlert, Info } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";

type Variant = "info" | "error";
type Toast = { id: number; message: string; variant: Variant };
type ShowToast = (message: string, options?: { variant?: Variant }) => void;

const DISMISS_AFTER_MS: Record<Variant, number> = { info: 4000, error: 7000 };

const ToastContext = createContext<ShowToast | null>(null);

/** Returns `toast(message, { variant })` for brief, self-dismissing feedback. */
export function useToast(): ShowToast {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast used outside ToastProvider");
  return toast;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const toast = useCallback<ShowToast>((message, options) => {
    const id = nextId.current++;
    const variant = options?.variant ?? "info";
    setToasts((current) => [...current, { id, message, variant }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), DISMISS_AFTER_MS[variant]);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Sits above the floating action button; an open dialog covers it. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map(({ id, message, variant }) => {
          const Icon = variant === "error" ? CircleAlert : Info;
          return (
            <div
              key={id}
              className={cn(
                "toast pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg",
                variant === "error" ? "border-danger bg-danger-bg text-danger" : "border-border bg-surface text-fg",
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
