import { Alert } from "./ui/Alert.tsx";
import { Button } from "./ui/Button.tsx";

/** Full-screen fallback when something the whole app depends on couldn't be loaded. */
export function LoadErrorPage({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
      <Alert>Can't reach the server right now.</Alert>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
