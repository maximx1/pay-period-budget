import { PageHeader } from "../../components/ui/PageHeader.tsx";
import { useCurrentUser } from "../auth/session.ts";
import { isNative } from "../../lib/platform.ts";
import { AppLockSection } from "./AppLockSection.tsx";
import { AppearanceSection } from "./AppearanceSection.tsx";
import { BudgetSection } from "./BudgetSection.tsx";
import { DevicesSection } from "./DevicesSection.tsx";
import { PasswordSection } from "./PasswordSection.tsx";
import { Detail, SettingsSection } from "./SettingsSection.tsx";

export function SettingsPage() {
  const user = useCurrentUser();

  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex max-w-3xl flex-col gap-4">
        <SettingsSection title="Profile">
          <dl className="flex flex-col gap-3">
            <Detail label="Username">{user.username}</Detail>
            <Detail label="Email">{user.email}</Detail>
          </dl>
        </SettingsSection>
        <BudgetSection />
        <AppearanceSection />
        {isNative && <AppLockSection />}
        <PasswordSection />
        <DevicesSection />
      </div>
    </>
  );
}
