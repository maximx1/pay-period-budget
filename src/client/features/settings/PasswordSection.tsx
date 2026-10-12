import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { changePasswordSchema, PASSWORD_MIN_LENGTH } from "../../../shared/auth.ts";
import { Alert } from "../../components/ui/Alert.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { PasswordField } from "../../components/ui/TextField.tsx";
import { useToast } from "../../components/ui/Toaster.tsx";
import { applyApiError } from "../auth/formErrors.ts";
import { useChangePassword } from "./api.ts";
import { SettingsSection } from "./SettingsSection.tsx";

const formSchema = changePasswordSchema
  .extend({ confirmPassword: z.string().min(1, "Re-enter the new password") })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match",
  });
type FormValues = z.infer<typeof formSchema>;

export function PasswordSection() {
  const toast = useToast();
  const changePassword = useChangePassword();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setFormError(null);
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      reset();
      toast("Password changed. Other devices were signed out and API tokens revoked.");
    } catch (error) {
      setFormError(applyApiError(error, setError, ["currentPassword", "newPassword"]));
    }
  });

  return (
    <SettingsSection title="Password" description="Changing it signs you out everywhere except here and revokes your API tokens.">
      <form onSubmit={onSubmit} noValidate className="flex max-w-sm flex-col gap-4">
        {formError && <Alert>{formError}</Alert>}
        <PasswordField
          label="Current password"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...register("currentPassword")}
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
          error={errors.newPassword?.message}
          {...register("newPassword")}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />
        <Button type="submit" loading={changePassword.isPending} className="self-start">
          Change password
        </Button>
      </form>
    </SettingsSection>
  );
}
