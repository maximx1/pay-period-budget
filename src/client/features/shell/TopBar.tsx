import { Menu } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "../../components/ui/IconButton.tsx";

const ACTIONS_ID = "top-bar-actions";

/**
 * Puts a page's own control (an icon button) at the end of the small-screen top bar, where
 * there is room for it. From `lg` up there is no top bar and nothing is shown: give the
 * same control a place of its own on the page there.
 */
export function TopBarAction({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(ACTIONS_ID)), []);
  return slot ? createPortal(children, slot) : null;
}

type TopBarProps = {
  title: string;
  menuOpen: boolean;
  onMenu: () => void;
};

/** Small-screen header: opens the navigation drawer and names the current section. */
export function TopBar({ title, menuOpen, onMenu }: TopBarProps) {
  return (
    <header className="shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)] lg:hidden">
      <div className="flex h-14 items-center gap-1 px-2">
        <IconButton label="Open menu" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={onMenu}>
          <Menu className="size-6" aria-hidden />
        </IconButton>
        {/* The page's own <h1> (see PageHeader) is what assistive tech reads. */}
        <p aria-hidden className="truncate text-lg font-semibold text-fg">
          {title}
        </p>
        <div id={ACTIONS_ID} className="ml-auto flex shrink-0 items-center" />
      </div>
    </header>
  );
}
