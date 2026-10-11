import { Settings } from "lucide-react";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";

// Placeholder. Phase 7 adds profile, password, devices, budget and appearance settings.
export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <Card>
        <EmptyState icon={Settings} title="Settings" description="Not built yet (phase 7)." />
      </Card>
    </>
  );
}
