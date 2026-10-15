import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

const paddings = { none: "", md: "p-4 sm:p-5", lg: "p-6" };

// Each sets the border and background together, so a className never has to override them.
const tones = { default: "border-border bg-surface", warning: "border-warning/40 bg-warning-bg" };

type CardProps = HTMLAttributes<HTMLDivElement> & {
  padding?: keyof typeof paddings;
  /** "warning" tints the whole card, for something about it that needs looking at. */
  tone?: keyof typeof tones;
};

export function Card({ padding = "md", tone = "default", className, ...props }: CardProps) {
  return <div {...props} className={cn("rounded-2xl border", tones[tone], paddings[padding], className)} />;
}
