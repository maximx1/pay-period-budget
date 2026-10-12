import { House, type LucideIcon, ReceiptText, Settings } from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon };

export const navItems: readonly NavItem[] = [
  { to: "/", label: "Home", icon: House },
  // Called "recurring items" in the code; on screen they are bills and income, scheduled or not.
  { to: "/recurring", label: "Bills & income", icon: ReceiptText },
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
