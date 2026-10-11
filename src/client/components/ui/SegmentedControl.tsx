import { useId } from "react";

type SegmentedControlProps<T extends string> = {
  /** Names the group for assistive tech; shown above it unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
};

/** A short either/or choice shown as adjoining segments. A radio group underneath, so arrow keys work. */
export function SegmentedControl<T extends string>({ label, hideLabel, options, value, onChange }: SegmentedControlProps<T>) {
  const name = useId();

  return (
    <fieldset>
      <legend className={hideLabel ? "sr-only" : "mb-1.5 text-sm font-medium text-fg"}>{label}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-border bg-surface-2 p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-9 cursor-pointer items-center justify-center rounded-md px-3 text-sm font-medium text-muted transition-colors has-checked:bg-surface has-checked:text-fg has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring"
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
