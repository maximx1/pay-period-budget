import { LogOut } from "lucide-react";
import { Link, useLocation } from "react-router";
import { cn } from "../../lib/cn.ts";
import { useCurrentUser, useLogout } from "../auth/session.ts";
import { useWaitingSplits } from "../splits/api.ts";
import { navItemForPath, navItems } from "./navItems.ts";

const rowClass =
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Account summary, section links and log out. Used as the fixed panel and inside the drawer. */
export function SidePanel({ onNavigate }: { onNavigate?: () => void }) {
  const user = useCurrentUser();
  const logout = useLogout();
  const active = navItemForPath(useLocation().pathname);
  const waiting = useWaitingSplits();
  const anyWaiting = (waiting.data?.length ?? 0) > 0;
  const shown = navItems.filter((item) => !item.splits || anyWaiting || item === active);

  return (
    <div className="flex h-full w-full flex-col pl-[env(safe-area-inset-left)]">
      <div className="flex items-center gap-3 border-b border-border px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4">
        <div
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-fg uppercase"
        >
          {user.username.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-fg">{user.username}</p>
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
        <ul className="flex flex-col gap-1">
          {shown.map((item) => {
            const isActive = item === active;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={onNavigate}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    rowClass,
                    isActive ? "bg-surface-2 text-primary" : "text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <item.icon className="size-5 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className={cn(rowClass, "text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-60")}
        >
          <LogOut className="size-5 shrink-0" aria-hidden />
          Log out
        </button>
      </div>
    </div>
  );
}
