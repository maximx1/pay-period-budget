import { Repeat } from "lucide-react";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";

// Placeholder. Phase 5 puts recurring bills and income here.
export function RecurringPage() {
  return (
    <>
      <PageHeader title="Recurring" subtitle="Bills and income that repeat." />
      <Card>
        <EmptyState
          icon={Repeat}
          title="No recurring items yet"
          description="Coming in phase 5: add a bill or a paycheck once and it shows up in every period."
        />
      </Card>
    </>
  );
}
