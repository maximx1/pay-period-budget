import { useEffect } from "react";

export const APP_NAME = "Pay Period Budget";

/** Sets the browser tab title to "<title> · Pay Period Budget" (or the app's name alone) while the component is mounted. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title === APP_NAME ? APP_NAME : `${title} · ${APP_NAME}`;
    return () => {
      document.title = APP_NAME;
    };
  }, [title]);
}
