import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { useDocumentTitle } from "../../lib/useDocumentTitle.ts";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  /** Right-aligned controls, e.g. an "Add" button. */
  actions?: ReactNode;
};

/**
 * Heading for a page inside the app shell; also sets the browser tab title. Below `lg`
 * the top bar already shows the title, so the <h1> is kept for screen readers only and
 * just the subtitle and actions show.
 */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  useDocumentTitle(title);
  const visibleOnSmallScreens = Boolean(subtitle || actions);

  return (
    <header
      className={cn("flex flex-wrap items-start justify-between gap-3", visibleOnSmallScreens ? "mb-6" : "lg:mb-6")}
    >
      <div className="min-w-0">
        <h1 className="sr-only text-2xl font-bold lg:not-sr-only">{title}</h1>
        {subtitle && <p className="text-sm text-muted lg:mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
