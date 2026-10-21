import { CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

type AlertProps = {
  /**
   * "error" (the default) for something that failed; "warning" for something to keep an eye
   * on; "danger" for how things stand when it needs dealing with soon (money set to run out).
   */
  tone?: "error" | "warning" | "danger";
  children: ReactNode;
};

export function Alert({ tone = "error", children }: AlertProps) {
  const Icon = tone === "error" ? CircleAlert : TriangleAlert;
  return (
    <div
      // Warnings describe how things stand; they should not interrupt a screen reader the way a failure does.
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm",
        tone === "error" && "bg-danger-bg text-danger",
        tone === "warning" && "bg-warning-bg text-fg",
        tone === "danger" && "border border-danger bg-danger-bg text-fg",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "warning" && "text-warning", tone === "danger" && "text-danger")} aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}
