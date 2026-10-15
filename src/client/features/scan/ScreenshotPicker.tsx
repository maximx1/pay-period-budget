import { ImagePlus, ScanText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { cn } from "../../lib/cn.ts";
import { isNative } from "../../lib/platform.ts";

/** The most screenshots read in one go. */
export const MAX_SCREENSHOTS = 10;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

/** The pictures among pasted or dropped things, as many as are read at once. */
const picturesIn = (files: FileList | null | undefined) =>
  [...(files ?? [])].filter((file) => ACCEPTED.includes(file.type)).slice(0, MAX_SCREENSHOTS);

// With a keyboard and a mouse, pasting and dropping are offered too. A phone picks from its gallery.
const hasKeyboard = () => !isNative && (window.matchMedia?.("(pointer: fine)").matches ?? false);
const pasteKeys = () => (/mac|iphone|ipad/i.test(navigator.userAgent) ? "⌘V" : "Ctrl+V");

/**
 * The "From screenshots" tab of the add dialog: picks the pictures to read, from a file
 * chooser (the gallery on a phone), the clipboard or a drag and drop.
 */
export function ScreenshotPicker({ onPick }: { onPick: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [keyboard] = useState(hasKeyboard);

  // A screenshot pasted anywhere while this tab shows. Text pasted into a field is left alone.
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = picturesIn(event.clipboardData?.files);
      if (files.length === 0) return;
      event.preventDefault();
      onPick(files);
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [onPick]);

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
        dragging ? "border-primary bg-surface-2" : "border-transparent",
      )}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const files = picturesIn(event.dataTransfer.files);
        if (files.length > 0) onPick(files);
      }}
    >
      <ScanText className="size-10 text-muted" aria-hidden />
      <p className="font-semibold">Import from your bank&rsquo;s app or website</p>
      <p className="max-w-sm text-sm text-muted">
        Take screenshots of the list of transactions and pick them here, up to {MAX_SCREENSHOTS} at once. Your server reads
        them, and you choose what to import.
      </p>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(",")}
        multiple
        hidden
        onChange={(event) => {
          const files = picturesIn(event.target.files);
          // Picking the same pictures again should work too.
          event.target.value = "";
          if (files.length > 0) onPick(files);
        }}
      />
      <Button data-autofocus onClick={() => input.current?.click()}>
        <ImagePlus className="size-4" aria-hidden />
        Choose screenshots
      </Button>
      {keyboard && (
        <p className="text-sm text-muted">
          Or paste one with <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-xs text-fg">{pasteKeys()}</kbd>, or
          drop them here.
        </p>
      )}
    </div>
  );
}
