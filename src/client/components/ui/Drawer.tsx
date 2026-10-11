import type { ReactNode } from "react";
import { useModal } from "./useModal.ts";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the panel. */
  label: string;
  children: ReactNode;
};

/** A modal panel that slides in from the left edge. Closed, it is not in the tab order at all. */
export function Drawer({ open, onClose, label, children }: DrawerProps) {
  const modal = useModal(open, onClose);

  return (
    <dialog
      {...modal}
      aria-label={label}
      className="drawer m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-border bg-surface p-0 text-fg shadow-xl backdrop:bg-black/50 open:flex"
    >
      {children}
    </dialog>
  );
}
