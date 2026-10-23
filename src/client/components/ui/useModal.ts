import { type DialogHTMLAttributes, type RefObject, useEffect, useRef } from "react";

type ModalProps = Pick<
  DialogHTMLAttributes<HTMLDialogElement>,
  "onCancel" | "onClose" | "onPointerDown" | "onClick" | "onInput"
> & {
  ref: RefObject<HTMLDialogElement | null>;
};

/**
 * Drives a native <dialog> as a controlled modal. Spread the result onto the element.
 * showModal() supplies the focus trap, Escape, the backdrop and focus return; this adds
 * the `open` prop, backdrop-click dismissal and initial focus on `[data-autofocus]`.
 * Once anything inside has been typed or changed, a backdrop click no longer dismisses:
 * a stray tap beside a half-filled form would throw it away.
 */
export function useModal(open: boolean, onClose: () => void): ModalProps {
  const ref = useRef<HTMLDialogElement>(null);
  const pressStartedOnBackdrop = useRef(false);
  const edited = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      edited.current = false;
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return {
    ref,
    // Escape: keep the element open until the owner agrees by flipping `open`.
    onCancel: (event) => {
      event.preventDefault();
      onClose();
    },
    // The browser closed it anyway (e.g. Escape pressed twice): bring state back in line.
    onClose: () => {
      if (open) onClose();
    },
    // A click lands on the dialog element itself only when it hits the backdrop. Require
    // the press to start there too, so dragging a text selection out of a field doesn't dismiss.
    onPointerDown: (event) => {
      pressStartedOnBackdrop.current = event.target === event.currentTarget;
    },
    onClick: (event) => {
      if (event.target === event.currentTarget && pressStartedOnBackdrop.current && !edited.current) onClose();
    },
    // Fields, selects, checkboxes and radios all fire `input`, and it bubbles up to here.
    onInput: () => {
      edited.current = true;
    },
  };
}
