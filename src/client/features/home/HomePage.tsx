import { Wallet } from "lucide-react";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { PageHeader } from "../../components/ui/PageHeader.tsx";

// Placeholder. Phase 3 puts the current pay period here; phase 4 adds its transactions.
export function HomePage() {
  return (
    <>
      <PageHeader title="Home" />
      <Card>
        <EmptyState
          icon={Wallet}
          title="Your pay period will show here"
          description="Coming in phase 3: budget setup and the current period."
        />
      </Card>
    </>
  );
}
