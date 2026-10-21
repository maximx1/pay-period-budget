import { ChartColumn, House, type LucideIcon, MessageSquareText, Repeat, Settings, Split, Tags } from "lucide-react";
import { APP_NAME } from "../../lib/useDocumentTitle.ts";

/**
 * `title` is what the page is headed with, when that differs from its name in the menu.
 * `advice` marks a section shown only when the server has Advice turned on; `splits`, one
 * shown only while a split has payments waiting (or while it is open).
 */
export type NavItem = { to: string; label: string; icon: LucideIcon; title?: string; advice?: true; splits?: true };

export const navItems: readonly NavItem[] = [
  { to: "/", label: "Home", icon: House, title: APP_NAME },
  { to: "/bills-income", label: "Recurring", icon: Repeat },
  { to: "/categories", label: "Categories", icon: Tags },
  { to: "/splits", label: "Split payments", icon: Split, splits: true },
  { to: "/reports", label: "Reports", icon: ChartColumn },
  { to: "/advice", label: "Advice", icon: MessageSquareText, advice: true },
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
