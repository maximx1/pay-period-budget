import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PASSWORD_MIN_LENGTH, registerInputSchema } from "../../../shared/auth.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { PasswordField, TextField } from "../../components/ui/TextField.tsx";
import { applyApiError } from "./formErrors.ts";
import { useRegister } from "./session.ts";

const registerFormSchema = registerInputSchema
  .extend({ confirmPassword: z.string().min(1, "Re-enter your password") })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match",
  });

type RegisterValues = z.input<typeof registerFormSchema>;

export function RegisterForm() {
  const registerAccount = useRegister();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterValues, unknown, z.output<typeof registerFormSchema>>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { username: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async ({ username, email, password }) => {
    setFormError(null);
    try {
      await registerAccount.mutateAsync({ username, email, password });
    } catch (error) {
      setFormError(applyApiError(error, setError, ["username", "email", "password"]));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && <Alert>{formError}</Alert>}
      <TextField
        label="Username"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
        error={errors.username?.message}
        {...register("username")}
      />
      <TextField
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        error={errors.email?.message}
        {...register("email")}
      />
      <PasswordField
        label="Password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
        error={errors.password?.message}
        {...register("password")}
      />
      <PasswordField
        label="Confirm password"
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register("confirmPassword")}
      />
      <Button type="submit" loading={registerAccount.isPending} className="mt-2">
        Create account
      </Button>
    </form>
  );
}
