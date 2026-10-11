import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

const paddings = { none: "", md: "p-4 sm:p-5", lg: "p-6" };

type CardProps = HTMLAttributes<HTMLDivElement> & {
  padding?: keyof typeof paddings;
};

export function Card({ padding = "md", className, ...props }: CardProps) {
  return <div {...props} className={cn("rounded-2xl border border-border bg-surface", paddings[padding], className)} />;
}
