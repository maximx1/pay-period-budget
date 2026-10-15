import { ChartColumn, House, type LucideIcon, ReceiptText, Settings, Tags } from "lucide-react";
import { APP_NAME } from "../../lib/useDocumentTitle.ts";

/** `title` is what the page is headed with, when that differs from its name in the menu. */
export type NavItem = { to: string; label: string; icon: LucideIcon; title?: string };

export const navItems: readonly NavItem[] = [
  { to: "/", label: "Home", icon: House, title: APP_NAME },
  { to: "/bills-income", label: "Bills & Income", icon: ReceiptText },
  { to: "/categories", label: "Categories", icon: Tags },
  { to: "/reports", label: "Reports", icon: ChartColumn },
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
