import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { loginInputSchema } from "../../../shared/auth.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { PasswordField, TextField } from "../../components/ui/TextField.tsx";
import { idleSignOutMinutes } from "../../lib/idle.ts";
import { applyApiError } from "./formErrors.ts";
import { useLogin } from "./session.ts";

type LoginValues = z.input<typeof loginInputSchema>;

export function LoginForm() {
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);
  // Set when the app signed out by itself; gone again after the next sign-in.
  const [idleMinutes] = useState(idleSignOutMinutes);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginValues, unknown, z.output<typeof loginInputSchema>>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { identifier: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login.mutateAsync(values);
    } catch (error) {
      setFormError(applyApiError(error, setError, ["identifier", "password"]));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert>{formError}</Alert>}
      {idleMinutes !== null && !formError && (
        <p role="status" className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-fg">
          You were signed out after {idleMinutes} {idleMinutes === 1 ? "minute" : "minutes"} without activity.
        </p>
      )}
      <TextField
        label="Username or email"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
        error={errors.identifier?.message}
        {...register("identifier")}
      />
      <PasswordField
        label="Password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <Button type="submit" loading={login.isPending} className="mt-2">
        Sign in
      </Button>
    </form>
  );
}
