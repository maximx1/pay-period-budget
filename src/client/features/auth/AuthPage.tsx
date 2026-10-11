import { Wallet } from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "../../lib/cn.ts";
import { LoginForm } from "./LoginForm.tsx";
import { RegisterForm } from "./RegisterForm.tsx";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex-1 border-b-2 pb-3 text-center text-sm font-semibold transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    isActive ? "border-primary text-primary" : "border-transparent text-muted hover:text-fg",
  );

export function AuthPage({ mode }: { mode: "login" | "register" }) {
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

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <nav className="mb-6 flex border-b border-border" aria-label="Sign in or create an account">
            <NavLink to="/login" replace className={tabClass}>
              Sign in
            </NavLink>
            <NavLink to="/register" replace className={tabClass}>
              Create account
            </NavLink>
          </nav>
          {mode === "login" ? <LoginForm /> : <RegisterForm />}
        </div>
      </div>
    </main>
  );
}
