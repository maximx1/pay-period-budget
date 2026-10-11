import { useEffect } from "react";

const APP_NAME = "Pay Period Budget";

/** Sets the browser tab title to "<title> · Pay Period Budget" while the component is mounted. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`;
    return () => {
      document.title = APP_NAME;
    };
  }, [title]);
}
