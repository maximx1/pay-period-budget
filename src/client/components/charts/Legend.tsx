/** Which colour is which series. Always shown for two or more, so colour is never the only clue. */
export function Legend({ items }: { items: ReadonlyArray<{ name: string; color: string; line?: boolean }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {items.map(({ name, color, line }) => (
        <li key={name} className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className={line ? "h-0.5 w-4 shrink-0 rounded-full" : "size-2.5 shrink-0 rounded-sm"}
            style={{ backgroundColor: color }}
          />
          <span className="truncate">{name}</span>
        </li>
      ))}
    </ul>
  );
}
