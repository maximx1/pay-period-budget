import { useEffect, useState } from "react";
import { useToast } from "../../components/ui/Toaster.tsx";
import { biometricUnlockAvailable, biometricUnlockEnabled, setBiometricUnlock } from "../../lib/sessionStore.ts";
import { SettingsSection } from "./SettingsSection.tsx";

/** Android app only: whether opening the app asks for a fingerprint or face instead of staying open. */
export function AppLockSection() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(biometricUnlockEnabled);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let stale = false;
    void biometricUnlockAvailable().then((result) => {
      if (!stale) setAvailable(result);
    });
    return () => {
      stale = true;
    };
  }, []);

  async function change(next: boolean) {
    setWorking(true);
    const changed = await setBiometricUnlock(next);
    setWorking(false);
    if (changed) setEnabled(next);
    else toast("Fingerprint unlock wasn't turned on.", { variant: "error" });
  }

  // It can always be turned off; turning it on needs something enrolled.
  const usable = enabled || available === true;

  return (
    <SettingsSection title="App lock" description="On this phone only.">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-fg">
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={enabled}
          disabled={!usable || working}
          onChange={(event) => change(event.target.checked)}
        />
        Unlock with fingerprint or face
      </label>
      <p className="mt-1 text-sm text-muted">
        {available === false && !enabled
          ? "Add a fingerprint or face in the phone's settings to use this."
          : "Asks when you open the app, and again after five minutes away. Your password still works."}
      </p>
    </SettingsSection>
  );
}
