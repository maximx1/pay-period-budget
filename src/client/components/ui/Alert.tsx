import { CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

type AlertProps = {
  /** "error" (the default) for something that failed; "warning" for something to keep an eye on. */
  tone?: "error" | "warning";
  children: ReactNode;
};

export function Alert({ tone = "error", children }: AlertProps) {
  const warning = tone === "warning";
  const Icon = warning ? TriangleAlert : CircleAlert;
  return (
    <div
      // A warning describes how things stand; it should not interrupt a screen reader the way a failure does.
      role={warning ? "status" : "alert"}
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm",
        warning ? "bg-warning-bg text-fg" : "bg-danger-bg text-danger",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", warning && "text-warning")} aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}
