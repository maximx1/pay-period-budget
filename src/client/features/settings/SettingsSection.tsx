import type { ReactNode } from "react";
import { Card } from "../../components/ui/Card.tsx";

type SettingsSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <Card>
      <h2 className="font-semibold text-fg">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

/** A label and its value, side by side where there is room. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-sm text-muted sm:w-40">{label}</dt>
      <dd className="min-w-0 text-sm font-medium break-words text-fg">{children}</dd>
    </div>
  );
}
