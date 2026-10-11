import { CalendarSearch, House, type LucideIcon, Repeat, Settings } from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon };

export const navItems: readonly NavItem[] = [
  { to: "/", label: "Home", icon: House },
  { to: "/search", label: "Date search", icon: CalendarSearch },
  { to: "/recurring", label: "Recurring", icon: Repeat },
  { to: "/settings", label: "Settings", icon: Settings },
];

const home = navItems[0]!;

/** The section a path belongs to. Anything outside the other sections counts as Home. */
export function navItemForPath(pathname: string): NavItem {
  const match = navItems.find(
    (item) => item !== home && (pathname === item.to || pathname.startsWith(`${item.to}/`)),
  );
  return match ?? home;
}
