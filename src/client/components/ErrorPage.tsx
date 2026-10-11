import { useRouteError } from "react-router";
import { Alert } from "./ui/Alert.tsx";
import { Button } from "./ui/Button.tsx";

/** Last-resort screen for an error thrown while rendering a route. */
export function ErrorPage() {
  const error = useRouteError();
  console.error(error);

  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
      <Alert>Something went wrong on this screen.</Alert>
      <Button variant="secondary" onClick={() => window.location.assign("/")}>
        Reload
      </Button>
    </main>
  );
}
