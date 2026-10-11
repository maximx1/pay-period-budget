import { LoaderCircle } from "lucide-react";

export function FullPageSpinner() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-label="Loading">
      <LoaderCircle className="size-8 animate-spin text-primary" aria-hidden />
    </div>
  );
}
