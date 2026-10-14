import { useState, useRef, useEffect } from "react";

interface PlusRowProps {
  onConfirm: (name: string) => void;
  display: "tile" | "row" | "list-item";
}

export default function PlusRow({ onConfirm, display }: PlusRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    const trimmed = value.trim();
    if (trimmed) {
      onConfirm(trimmed);
    }
    setEditing(false);
    setValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      setEditing(false);
      setValue("");
    }
  }

  if (display === "tile") {
    if (editing) {
      return (
        <div className="flex flex-col items-center gap-1 p-2 rounded-lg border border-neutral-600 bg-neutral-800">
          <div className="w-10 h-10 flex items-center justify-center text-neutral-500 text-xl">
            📁
          </div>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commit}
            className="w-full text-xs text-center bg-neutral-700 text-neutral-100 rounded px-1 py-0.5 outline-none border border-neutral-500"
            placeholder="Folder name"
          />
        </div>
      );
    }
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex flex-col items-center gap-1 p-2 rounded-lg border border-dashed border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800/50 transition-colors cursor-pointer"
      >
        <div className="w-10 h-10 flex items-center justify-center text-neutral-500 hover:text-neutral-400 text-2xl leading-none">
          +
        </div>
        <span className="text-xs text-neutral-500">New folder</span>
      </button>
    );
  }

  // "row" and "list-item" share the same layout
  if (editing) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-neutral-500 text-sm">📁</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          className="flex-1 text-sm bg-neutral-700 text-neutral-100 rounded px-2 py-0.5 outline-none border border-neutral-500"
          placeholder="Folder name"
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center gap-2 px-3 py-1.5 w-full text-left text-neutral-500 hover:text-neutral-400 hover:bg-neutral-800/50 transition-colors"
    >
      <span className="text-lg leading-none">+</span>
      <span className="text-sm">New folder</span>
    </button>
  );
}
