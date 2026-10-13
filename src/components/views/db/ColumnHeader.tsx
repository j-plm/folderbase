interface Props {
  label: string;
  sortActive: boolean;
  sortDir: "asc" | "desc";
  onSort: () => void;
  className?: string;
}

export default function ColumnHeader({
  label,
  sortActive,
  sortDir,
  onSort,
  className = "",
}: Props) {
  return (
    <button
      onClick={onSort}
      className={`${className} px-2 py-1.5 text-left text-xs font-medium text-neutral-400 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-neutral-200 transition-colors`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span
          className={`transition-opacity ${sortActive ? "opacity-100" : "opacity-0 group-hover:opacity-50"}`}
        >
          {sortDir === "asc" ? "↑" : "↓"}
        </span>
      </span>
    </button>
  );
}
