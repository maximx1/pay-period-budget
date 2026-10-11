import { useState } from "react";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { getThemeChoice, setThemeChoice, type ThemeChoice } from "../../lib/theme.ts";
import { SettingsSection } from "./SettingsSection.tsx";

const options = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export function AppearanceSection() {
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice);

  return (
    <SettingsSection title="Appearance" description="Remembered on this device.">
      <div className="max-w-xs">
        <SegmentedControl
          label="Colour scheme"
          hideLabel
          options={options}
          value={choice}
          onChange={(next) => {
            setChoice(next);
            setThemeChoice(next);
          }}
        />
      </div>
    </SettingsSection>
  );
}
