import type { ReactNode } from "react";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { useDevices, useSignOutDevice, useSignOutOtherDevices } from "./api.ts";
import { SettingsSection } from "./SettingsSection.tsx";

const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const when = (instant: string) => whenFormat.format(new Date(instant));

export function DevicesSection() {
  const toast = useToast();
  const devices = useDevices();
  const signOut = useSignOutDevice();
  const signOutOthers = useSignOutOtherDevices();
  const failed = () => toast("Couldn't sign that device out. Try again.", { variant: "error" });

  let content: ReactNode;
  if (devices.isPending) {
    content = <div className="h-16 animate-pulse rounded-lg bg-surface-2" role="status" aria-label="Loading devices" />;
  } else if (devices.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert>Couldn't load your devices.</Alert>
        <Button variant="secondary" onClick={() => devices.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else {
    const others = devices.data.filter((device) => !device.current);
    content = (
      <>
        <ul className="divide-y divide-border">
          {devices.data.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                  {device.device}
                  {device.current && (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-primary">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted">
                  Signed in {when(device.createdAt)} · last active {when(device.lastSeenAt)}
                </p>
              </div>
              {!device.current && (
                <Button
                  variant="secondary"
                  disabled={signOut.isPending}
                  onClick={() => signOut.mutate(device.id, { onError: failed })}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
        {others.length > 1 && (
          <Button
            variant="secondary"
            className="mt-2"
            loading={signOutOthers.isPending}
            onClick={() => signOutOthers.mutate(undefined, { onError: failed })}
          >
            Sign out everywhere else
          </Button>
        )}
      </>
    );
  }

  return (
    <SettingsSection title="Signed-in devices" description="Everywhere this account is currently signed in.">
      {content}
    </SettingsSection>
  );
}
