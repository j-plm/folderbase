import type { DbPreset } from "../../../types";

const PRESETS: { preset: DbPreset; label: string }[] = [
  { preset: "path", label: "Current Path" },
  { preset: "library", label: "Library" },
  { preset: "incomplete", label: "Incomplete Files" },
];

interface Props {
  active: DbPreset;
  onChange: (p: DbPreset) => void;
}

export default function PresetBar({ active, onChange }: Props) {
  return (
    <div className="flex items-center gap-px px-3 py-1.5 border-b border-neutral-700/60 bg-neutral-850/30 shrink-0">
      <span className="text-xs text-neutral-500 mr-2">View:</span>
      <div className="flex items-center gap-px bg-neutral-700/50 rounded-md p-0.5">
        {PRESETS.map(({ preset, label }) => (
          <button
            key={preset}
            onClick={() => onChange(preset)}
            className={`px-2.5 py-0.5 text-xs rounded transition-colors ${
              active === preset
                ? "bg-neutral-600 text-neutral-100"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
