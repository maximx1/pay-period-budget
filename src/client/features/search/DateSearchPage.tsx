import { CalendarSearch } from "lucide-react";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";

// Placeholder. What this page does is still undecided; see task 7.1 in docs/plan.
export function DateSearchPage() {
  return (
    <>
      <PageHeader title="Date search" />
      <Card>
        <EmptyState icon={CalendarSearch} title="Date search" description="Not built yet (phase 7)." />
      </Card>
    </>
  );
}
