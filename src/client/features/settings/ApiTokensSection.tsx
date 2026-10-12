import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import {
  type ApiTokenInfo,
  apiTokenInputSchema,
  type ApiTokenScope,
  MAX_API_TOKENS,
} from "../../../shared/auth.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Dialog, DialogActions } from "../../components/ui/Dialog.tsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.tsx";
import { SelectField } from "../../components/ui/SelectField.tsx";
import { TextField } from "../../components/ui/TextField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { applyApiError } from "../auth/formErrors.ts";
import { useApiTokens, useCreateApiToken, useRevokeApiToken } from "./api.ts";
import { SettingsSection } from "./SettingsSection.tsx";

const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const day = (instant: string) => dayFormat.format(new Date(instant));

const scopeLabels: Record<ApiTokenScope, string> = { read: "Read only", write: "Read and write" };
const scopeOptions = [
  { value: "read", label: scopeLabels.read },
  { value: "write", label: scopeLabels.write },
] as const;

const expiryOptions = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
] as const;

const formSchema = apiTokenInputSchema
  .omit({ expiresInDays: true })
  .extend({ expiry: z.enum(expiryOptions.map((option) => option.value)) });
type FormValues = z.infer<typeof formSchema>;

const isExpired = (token: ApiTokenInfo) => token.expiresAt !== null && new Date(token.expiresAt).getTime() <= Date.now();

export function ApiTokensSection() {
  const toast = useToast();
  const tokens = useApiTokens();
  const revoke = useRevokeApiToken();
  const [creating, setCreating] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function revokeToken(token: ApiTokenInfo) {
    revoke.mutate(token.id, {
      onSuccess: () => toast(`Revoked "${token.name}".`),
      onError: () => toast("Couldn't revoke that token. Try again.", { variant: "error" }),
      onSettled: () => setConfirmingId(null),
    });
  }

  let content: ReactNode;
  if (tokens.isPending) {
    content = <div className="h-16 animate-pulse rounded-lg bg-surface-2" role="status" aria-label="Loading tokens" />;
  } else if (tokens.isError) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <Alert>Couldn't load your tokens.</Alert>
        <Button variant="secondary" onClick={() => tokens.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else {
    const atLimit = tokens.data.length >= MAX_API_TOKENS;
    content = (
      <>
        {tokens.data.length === 0 ? (
          <p className="text-sm text-muted">No tokens yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {tokens.data.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium break-words text-fg">
                    {token.name}
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
                      {scopeLabels[token.scope]}
                    </span>
                    {isExpired(token) && (
                      <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger">
                        Expired
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted">
                    Ends in <span className="font-mono">{token.hint}</span> · created {day(token.createdAt)} ·{" "}
                    {token.lastUsedAt ? `last used ${day(token.lastUsedAt)}` : "never used"} ·{" "}
                    {token.expiresAt === null
                      ? "never expires"
                      : `${isExpired(token) ? "expired" : "expires"} ${day(token.expiresAt)}`}
                  </p>
                </div>
                {confirmingId === token.id ? (
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={() => setConfirmingId(null)} disabled={revoke.isPending}>
                      Cancel
                    </Button>
                    <Button variant="danger" onClick={() => revokeToken(token)} loading={revoke.isPending}>
                      Revoke
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" disabled={revoke.isPending} onClick={() => setConfirmingId(token.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Button variant="secondary" className="mt-4" disabled={atLimit} onClick={() => setCreating(true)}>
          New token
        </Button>
        {atLimit && (
          <p className="mt-2 text-sm text-muted">You have {MAX_API_TOKENS} tokens, the most allowed. Revoke one to add another.</p>
        )}
      </>
    );
  }

  return (
    <SettingsSection
      title="API tokens"
      description="Keys that let a program, such as an AI assistant, work with your budget without your password. A token can't change your password, sign devices out or create other tokens."
    >
      {content}
      <NewTokenDialog open={creating} onClose={() => setCreating(false)} />
    </SettingsSection>
  );
}

function NewTokenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [secret, setSecret] = useState<string | null>(null);
  const close = () => {
    setSecret(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} title={secret ? "Copy your token" : "New API token"}>
      {secret ? <TokenSecret secret={secret} onClose={close} /> : <NewTokenForm onClose={close} onCreated={setSecret} />}
    </Dialog>
  );
}

function NewTokenForm({ onClose, onCreated }: { onClose: () => void; onCreated: (secret: string) => void }) {
  const create = useCreateApiToken();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", scope: "read", expiry: "90" },
  });

  const onSubmit = handleSubmit(async ({ name, scope, expiry }) => {
    setFormError(null);
    try {
      const created = await create.mutateAsync({
        name,
        scope,
        expiresInDays: expiry === "never" ? null : Number(expiry),
      });
      onCreated(created.secret);
    } catch (error) {
      setFormError(applyApiError(error, setError, ["name", "scope"]));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert>{formError}</Alert>}
      <TextField
        label="Name"
        autoComplete="off"
        data-autofocus
        hint="What will use it, so you can tell tokens apart later"
        error={errors.name?.message}
        {...register("name")}
      />
      <div className="flex flex-col gap-1.5">
        <Controller
          control={control}
          name="scope"
          render={({ field }) => (
            <SegmentedControl label="Access" options={scopeOptions} value={field.value} onChange={field.onChange} />
          )}
        />
        <p className="text-sm text-muted">Adding or importing transactions needs read and write.</p>
      </div>
      <SelectField label="Expires after" options={expiryOptions} error={errors.expiry?.message} {...register("expiry")} />
      <DialogActions>
        <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending}>
          Create token
        </Button>
      </DialogActions>
    </form>
  );
}

function TokenSecret({ secret, onClose }: { secret: string; onClose: () => void }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const box = useRef<HTMLElement>(null);
  // The form's button had the focus and is gone; without this it would fall out of the dialog.
  useEffect(() => box.current?.focus(), []);

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopy("copied");
    } catch {
      // No clipboard access, e.g. a page served over plain HTTP. Said here rather than in
      // a toast, which an open dialog covers. Leave the token selected, ready to copy.
      setCopy("failed");
      if (box.current) window.getSelection()?.selectAllChildren(box.current);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg">
        This is the only time the token is shown. Copy it now and keep it where the program that needs it can read it.
      </p>
      <code
        ref={box}
        tabIndex={0}
        aria-label="Your new token"
        className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-base break-all text-fg select-all focus:outline-2 focus:outline-offset-1 focus:outline-ring"
      >
        {secret}
      </code>
      {copy === "failed" && <Alert>Couldn't copy it for you. It's selected: copy it by hand.</Alert>}
      <p className="text-sm text-muted">If you lose it, revoke it and create another.</p>
      <DialogActions>
        <Button variant="secondary" onClick={copyToken}>
          {copy === "copied" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copy === "copied" ? "Copied" : "Copy"}
        </Button>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </div>
  );
}
