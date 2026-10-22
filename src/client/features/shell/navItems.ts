import { ChartColumn, House, Landmark, type LucideIcon, MessageSquareText, Repeat, Settings, Split, Tags } from "lucide-react";
import { APP_NAME } from "../../lib/useDocumentTitle.ts";

/**
 * `title` is what the page is headed with, when that differs from its name in the menu.
 * `splits` marks a section shown only while a split has payments waiting (or while it is open).
 */
export type NavItem = { to: string; label: string; icon: LucideIcon; title?: string; splits?: true };

export const navItems: readonly NavItem[] = [
  { to: "/", label: "Home", icon: House, title: APP_NAME },
  { to: "/bills-income", label: "Recurring", icon: Repeat },
  { to: "/balances", label: "Balances", icon: Landmark },
  { to: "/categories", label: "Categories", icon: Tags },
  { to: "/splits", label: "Split payments", icon: Split, splits: true },
  { to: "/reports", label: "Reports", icon: ChartColumn },
  // Always there: Quick Questions need no model; only Smart Questions do.
  { to: "/advice", label: "Advice", icon: MessageSquareText },
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
