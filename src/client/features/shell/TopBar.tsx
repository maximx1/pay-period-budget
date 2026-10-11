import { Menu } from "lucide-react";
import { IconButton } from "../../components/ui/IconButton.tsx";

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
      </div>
    </header>
  );
}
