import { useEffect, useState } from "react";
import { useToast } from "../../components/ui/Toaster.tsx";
import { biometricUnlockAvailable, biometricUnlockEnabled, setBiometricUnlock } from "../../lib/sessionStore.ts";
import { useIdleTimeoutMinutes } from "../auth/session.ts";
import { SettingsSection } from "./SettingsSection.tsx";

/** Android app only: whether opening the app asks for a face or fingerprint instead of staying open. */
export function AppLockSection() {
  const toast = useToast();
  const [enabled, setEnabled] = useState(biometricUnlockEnabled);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const idleMinutes = useIdleTimeoutMinutes() ?? 0;
  const afterIdle = `after ${idleMinutes} ${idleMinutes === 1 ? "minute" : "minutes"} without use`;

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
    else toast("Face or fingerprint unlock wasn't turned on.", { variant: "error" });
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
        Unlock with face or fingerprint
      </label>
      <p className="mt-1 text-sm text-muted">
        {available === false && !enabled
          ? "Add a fingerprint, or a face the phone accepts for apps, in the phone's settings to use this."
          : idleMinutes > 0
            ? `Asks when you open the app, and again ${afterIdle}. Your password still works.`
            : "Asks when you open the app. Your password still works."}
      </p>
      {!enabled && idleMinutes > 0 && (
        <p className="mt-1 text-sm text-muted">While this is off, the app signs you out {afterIdle}.</p>
      )}
    </SettingsSection>
  );
}
