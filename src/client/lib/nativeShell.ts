import { App } from "@capacitor/app";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { isLocked, noteAppHidden, noteAppShown } from "./sessionStore.ts";

// Behaviour only the Android app needs. Loaded on demand from main.tsx so none of it, nor
// the plugins it imports, ends up in what a browser downloads.

/**
 * Closes the topmost open dialog or drawer the way Escape would, and says whether there
 * was one. Both are native <dialog> elements driven by components/ui/useModal.ts, which
 * answers `cancel` by asking its owner to close.
 */
export function dismissTopModal(root: ParentNode = document): boolean {
  const open = root.querySelectorAll<HTMLDialogElement>("dialog[open]");
  const top = open[open.length - 1];
  if (!top) return false;
  top.dispatchEvent(new Event("cancel", { cancelable: true }));
  return true;
}

/** Hardware back: close what is open, else go back a screen, else leave the app. */
function handleBackButton() {
  void App.addListener("backButton", ({ canGoBack }) => {
    // Nothing behind the lock screen should move; Back just leaves.
    if (isLocked()) return void App.minimizeApp();
    if (dismissTopModal()) return;
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
}

/** Whether the app is currently drawn dark, by the user's choice or the device's. */
export function isDarkTheme(choice: string | null, deviceIsDark: boolean): boolean {
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return deviceIsDark;
}

/**
 * The page is drawn behind the status and navigation bars, so only their icons need to
 * follow the theme: light icons over a dark page and the other way round.
 */
function keepSystemBarsInStepWithTheme() {
  const device = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const dark = isDarkTheme(document.documentElement.getAttribute("data-theme"), device.matches);
    void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
  };
  apply();
  device.addEventListener("change", apply);
  // lib/theme.ts records the user's choice as this attribute.
  new MutationObserver(apply).observe(document.documentElement, { attributeFilter: ["data-theme"] });
}

/** With biometric unlock on, coming back after a while away asks for the fingerprint again. */
function lockAfterTimeAway() {
  void App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) noteAppShown();
    else noteAppHidden();
  });
}

export function initNativeShell() {
  handleBackButton();
  keepSystemBarsInStepWithTheme();
  lockAfterTimeAway();
}
