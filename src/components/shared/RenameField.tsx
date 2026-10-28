import { useRef, useState } from "react";

/**
 * A name edited in place, as in Finder: Return or clicking away renames, Escape
 * cancels (without closing a popover it sits in).
 */
export default function RenameField({
  initial,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  function finish(commit: boolean) {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(text);
    else onCancel();
  }
  return (
    <input
      autoFocus
      data-own-escape
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      // Clicks in the field edit it rather than selecting the row
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 h-5 px-1 -mx-1 rounded-[3px] bg-neutral-900 text-body text-neutral-100 outline outline-2 outline-blue-500"
    />
  );
}
