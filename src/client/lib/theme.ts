export type ThemeChoice = "system" | "light" | "dark";

// Must match public/theme.js, which applies the saved choice before first paint.
const STORAGE_KEY = "ppb-theme";

export function getThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Remembers the choice on this device and applies it now. "system" follows the device setting. */
export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Storage unavailable: the choice still applies until the page is reloaded.
  }
  if (choice === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", choice);
}
