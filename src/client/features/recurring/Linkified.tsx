import { splitLinks } from "../../../shared/links.ts";

/** Free text with its web addresses turned into links. Line breaks are kept as typed. */
export function Linkified({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, index) =>
        part.type === "link" ? (
          <a
            // Index keys are fine here: the parts are derived from the text and never reorder.
            key={index}
            href={part.value}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {part.value}
          </a>
        ) : (
          part.value
        ),
      )}
    </>
  );
}
