import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { markBiometricUnlockOffered, setBiometricUnlock, shouldOfferBiometricUnlock } from "../../lib/sessionStore.ts";

/**
 * Asked once per phone, after the first password sign-in on a device with a fingerprint or
 * face enrolled. Either answer is final here; Settings can change it later.
 */
export function BiometricOffer() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let stale = false;
    void shouldOfferBiometricUnlock().then((offer) => {
      if (offer && !stale) setOpen(true);
    });
    return () => {
      stale = true;
    };
  }, []);

  async function decline() {
    setOpen(false);
    await markBiometricUnlockOffered();
  }

  async function accept() {
    setWorking(true);
    const turnedOn = await setBiometricUnlock(true);
    await markBiometricUnlockOffered();
    setWorking(false);
    setOpen(false);
    toast(
      turnedOn ? "Fingerprint unlock is on." : "Fingerprint unlock wasn't turned on. You can do it later in Settings.",
      turnedOn ? undefined : { variant: "error" },
    );
  }

  return (
    <Dialog open={open} onClose={decline} title="Unlock with fingerprint or face next time?">
      <p className="text-sm text-muted">
        Skip the password on this phone. Your sign-in is kept locked, and only your fingerprint or face opens it.
      </p>
      <DialogActions>
        <Button variant="secondary" onClick={decline} disabled={working}>
          Not now
        </Button>
        <Button onClick={accept} loading={working} data-autofocus>
          Turn on
        </Button>
      </DialogActions>
    </Dialog>
  );
}
