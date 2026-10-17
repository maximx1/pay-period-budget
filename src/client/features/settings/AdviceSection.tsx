import { useEffect, useState } from "react";
import { ADVICE_PERSONAS, type AdvicePersonaId } from "../../../shared/advice.ts";
import { Button } from "../../components/ui/Button.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { ApiError } from "../../lib/api.ts";
import { useAdviceQuestions, useSetAdvicePersona } from "../advice/api.ts";
import { useAdviceEnabled } from "../auth/session.ts";
import { SettingsSection } from "./SettingsSection.tsx";

const options = ADVICE_PERSONAS.map(({ id, label }) => ({ value: id, label }));

/** The voice Advice answers in. Shown only when the server has Advice turned on. */
export function AdviceSection() {
  const enabled = useAdviceEnabled();
  const saved = useAdviceQuestions(enabled).data?.persona;
  const save = useSetAdvicePersona();
  const toast = useToast();
  const [persona, setPersona] = useState<AdvicePersonaId>("plain");
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!saved) return;
    setPersona(saved.persona);
    setCustom(saved.custom ?? "");
  }, [saved]);

  // "Change" on the Advice page links here; the section only appears once the voice is known.
  const shown = enabled && Boolean(saved);
  useEffect(() => {
    if (shown && window.location.hash === "#advice") document.getElementById("advice")?.scrollIntoView({ block: "start" });
  }, [shown]);

  if (!enabled || !saved) return null;
  const changed = persona !== saved.persona || (persona === "custom" && custom.trim() !== (saved.custom ?? ""));

  function submit() {
    setError(undefined);
    save.mutate(
      { persona, custom: persona === "custom" ? custom.trim() : null },
      {
        onSuccess: () => toast("Advice voice saved."),
        onError: (failure) => {
          const field = failure instanceof ApiError ? failure.fields?.custom : undefined;
          if (field) setError(field);
          else toast(failure instanceof ApiError ? failure.message : "Couldn't save that.", { variant: "error" });
        },
      },
    );
  }

  return (
    <div id="advice" className="scroll-mt-20">
      <SettingsSection title="Advice" description="The voice answers on the Advice page come in. The figures and the length stay the same.">
        <form
          noValidate
          className="flex max-w-sm flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <SelectField
            label="Answer as"
            options={options}
            value={persona}
            onChange={(event) => setPersona(event.target.value as AdvicePersonaId)}
          />
          {persona === "custom" && (
            <TextField
              label="Who should answer"
              placeholder="e.g. a pirate who hates waste"
              maxLength={120}
              value={custom}
              error={error}
              onChange={(event) => setCustom(event.target.value)}
            />
          )}
          <Button type="submit" className="self-start" disabled={!changed} loading={save.isPending}>
            Save
          </Button>
        </form>
      </SettingsSection>
    </div>
  );
}
