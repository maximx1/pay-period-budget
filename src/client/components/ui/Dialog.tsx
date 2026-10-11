import { X } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "./IconButton.tsx";
import { useModal } from "./useModal.ts";

type DialogProps = {
  open: boolean;
  /** Called for Escape, a backdrop click and the close button. */
  onClose: () => void;
  title: string;
  children: ReactNode;
};

/**
 * Modal dialog: a centred card on wider screens, a bottom sheet on phones. Children are
 * mounted only while open, so form state starts fresh each time. Put `data-autofocus` on
 * the element that should receive focus; otherwise the first focusable one gets it.
 */
export function Dialog({ open, onClose, title, children }: DialogProps) {
  const titleId = useId();
  const modal = useModal(open, onClose);

  return (
    <dialog
      {...modal}
      aria-labelledby={titleId}
      className={cn(
        "modal-sheet max-h-[90dvh] flex-col overflow-hidden bg-surface p-0 text-fg shadow-xl backdrop:bg-black/50 open:flex",
        "m-0 mt-auto w-full max-w-none rounded-t-2xl",
        "sm:m-auto sm:max-w-md sm:rounded-2xl",
      )}
    >
      {open && (
        <>
          <h2 id={titleId} className="shrink-0 px-5 pt-5 pr-14 text-lg font-semibold">
            {title}
          </h2>
          <div className="overflow-y-auto px-5 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">{children}</div>
          {/* Last in the DOM so a field, not this, is the first focusable element. */}
          <IconButton label="Close" onClick={onClose} className="absolute top-2 right-2">
            <X className="size-5" aria-hidden />
          </IconButton>
        </>
      )}
    </dialog>
  );
}

/** Button row at the foot of a dialog. Primary action last; it sits on top when stacked on phones. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}
