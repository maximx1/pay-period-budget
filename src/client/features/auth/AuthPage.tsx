import { Wallet } from "lucide-react";
import { Navigate, NavLink } from "react-router";
import { Card } from "../../components/ui/Card.tsx";
import { cn } from "../../lib/cn.ts";
import { useDocumentTitle } from "../../lib/useDocumentTitle.ts";
import { LoginForm } from "./LoginForm.tsx";
import { RegisterForm } from "./RegisterForm.tsx";
import { useRegistrationOpen } from "./session.ts";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex-1 border-b-2 pb-3 text-center text-sm font-semibold transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    isActive ? "border-primary text-primary" : "border-transparent text-muted hover:text-fg",
  );

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  useDocumentTitle(mode === "login" ? "Sign in" : "Create account");
  // Until the server says otherwise, assume accounts can be created.
  const registrationClosed = useRegistrationOpen() === false;
  if (registrationClosed && mode === "register") return <Navigate to="/login" replace />;

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-fg">
            <Wallet className="size-6" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-fg">Pay Period Budget</h1>
          <p className="text-sm text-muted">Budget from payday to payday.</p>
        </div>

        <Card padding="lg" className="shadow-sm">
          {registrationClosed ? (
            <h2 className="mb-6 text-center text-sm font-semibold text-fg">Sign in</h2>
          ) : (
            <nav className="mb-6 flex border-b border-border" aria-label="Sign in or create an account">
              <NavLink to="/login" replace className={tabClass}>
                Sign in
              </NavLink>
              <NavLink to="/register" replace className={tabClass}>
                Create account
              </NavLink>
            </nav>
          )}
          {mode === "login" ? <LoginForm /> : <RegisterForm />}
        </Card>
      </div>
    </main>
  );
}
