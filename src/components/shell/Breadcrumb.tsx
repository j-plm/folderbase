import { useNavigation } from "../../contexts/NavigationContext";

interface Props {
  viewName: string;
}

export default function Breadcrumb({ viewName }: Props) {
  const { path, popToIndex } = useNavigation();

  // Crumb list: root (the view name) followed by each path segment.
  // root = index 0, path[0] = index 1, path[1] = index 2, etc.
  const totalCrumbs = 1 + path.length;
  const lastIndex = totalCrumbs - 1;

  function renderCrumb(label: string, crumbIndex: number) {
    const isCurrent = crumbIndex === lastIndex;
    return (
      <span key={crumbIndex} data-tauri-drag-region className="flex items-center gap-1 min-w-0">
        {crumbIndex > 0 && (
          <span data-tauri-drag-region className="text-neutral-500 shrink-0">/</span>
        )}
        {isCurrent ? (
          <span data-tauri-drag-region className="text-[15px] font-semibold text-neutral-100 truncate">{label}</span>
        ) : (
          <button
            onClick={() => popToIndex(crumbIndex)}
            className="text-neutral-400 hover:text-neutral-200 truncate transition-colors"
          >
            {label}
          </button>
        )}
      </span>
    );
  }

  return (
    <nav
      data-tauri-drag-region
      aria-label="breadcrumb"
      className="flex items-center gap-0.5 min-w-0 overflow-hidden text-sm"
    >
      {renderCrumb(viewName, 0)}
      {path.map((segment, i) => renderCrumb(segment, i + 1))}
    </nav>
  );
}
