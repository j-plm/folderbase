import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { settingsInitialPane, type SettingsPane } from "../../lib/commands";
import { SymbolIcon } from "../../lib/fileIcons";
import { platform } from "../../lib/platform";
import { useEditMenu } from "../../hooks/useEditMenu";
import GeneralPane from "./GeneralPane";
import LocationsPane from "./LocationsPane";
import NewViewsPane from "./NewViewsPane";
import FilesPane from "./FilesPane";
import AdvancedPane from "./AdvancedPane";

/*
 * The Settings window (spec ▸ Settings): every choice that isn't part of a view.
 * On macOS a toolbar of panes, the window titled with the pane shown and sized
 * to fit it, as Finder's Settings is; elsewhere the sections are listed down the
 * left. Changes apply at once: there's no OK or Apply.
 *
 * Duplicates and Sharing join the panes as those features arrive; their
 * settings have nothing to act on yet.
 */

interface PaneInfo {
  id: SettingsPane;
  label: string;
  symbol: string;
  fallback: string;
}

const PANES: PaneInfo[] = [
  { id: "general", label: "General", symbol: "gearshape", fallback: "⚙" },
  { id: "locations", label: "Locations", symbol: "folder", fallback: "▤" },
  { id: "new-views", label: "New Views", symbol: "rectangle.stack", fallback: "▦" },
  { id: "files", label: "Files", symbol: "doc.on.doc", fallback: "▢" },
  { id: "advanced", label: "Advanced", symbol: "gearshape.2", fallback: "⚙" },
];

const PANE_KEY = "settings-pane";
const WIDTH = 660;
/** Locations lists the locations beside their settings, so it's wider and keeps one height. */
const LOCATIONS_SIZE = { width: 760, height: 560 };
const isPane = (p: unknown): p is SettingsPane => PANES.some((x) => x.id === p);

function lastPane(): SettingsPane {
  try {
    const saved = localStorage.getItem(PANE_KEY);
    return isPane(saved) ? saved : "general";
  } catch {
    return "general";
  }
}

export default function SettingsApp() {
  const [pane, setPane] = useState<SettingsPane>(lastPane);
  const header = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // Typing in a field undoes with ⌘Z here, as anywhere
  useEditMenu();

  useEffect(() => {
    void settingsInitialPane().then((p) => p && setPane(p));
    const unlisten = listen<string>("settings-pane", (e) => isPane(e.payload) && setPane(e.payload));
    return () => void unlisten.then((f) => f());
  }, []);

  useEffect(() => {
    const info = PANES.find((p) => p.id === pane)!;
    void getCurrentWindow().setTitle(platform === "linux" ? "Preferences" : info.label);
    try {
      localStorage.setItem(PANE_KEY, pane);
    } catch {
      // Only a convenience
    }
  }, [pane]);

  // The window fits the pane (macOS): its height follows the content as it changes
  useLayoutEffect(() => {
    const content = body.current;
    if (!content) return;
    const fit = () => {
      if (pane === "locations") {
        void getCurrentWindow().setSize(new LogicalSize(LOCATIONS_SIZE.width, LOCATIONS_SIZE.height));
        return;
      }
      const top = platform === "macos" ? (header.current?.offsetHeight ?? 0) : 0;
      const height = Math.min(Math.ceil(top + content.scrollHeight), Math.round(window.screen.availHeight * 0.9));
      void getCurrentWindow().setSize(new LogicalSize(platform === "macos" ? WIDTH : WIDTH + 180, Math.max(height, 240)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(content);
    return () => observer.disconnect();
  }, [pane]);

  const content = (
    <div ref={body} className={pane === "locations" ? "h-full" : "px-8 pt-6 pb-5"}>
      {pane === "general" && <GeneralPane />}
      {pane === "locations" && <LocationsPane />}
      {pane === "new-views" && <NewViewsPane />}
      {pane === "files" && <FilesPane />}
      {pane === "advanced" && <AdvancedPane />}
    </div>
  );

  if (platform !== "macos") {
    // Windows' Settings: a page with its sections down the left
    return (
      <Shell>
        <nav className="w-[180px] shrink-0 flex flex-col gap-0.5 p-2 border-r border-neutral-700/60">
          {PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPane(p.id)}
              className={`flex items-center gap-2 h-8 px-2 rounded-[4px] text-left ${pane === p.id ? "bg-neutral-700/70" : "hover:bg-neutral-800"}`}
            >
              <SymbolIcon name={p.symbol} size={16} fallback={p.fallback} />
              {p.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0 overflow-y-auto">{content}</div>
      </Shell>
    );
  }

  const current = PANES.find((p) => p.id === pane)!;
  return (
    <Shell column>
      {/* Title bar and toolbar in one, as a macOS settings window has them; drag anywhere on it */}
      <div ref={header} data-tauri-drag-region className="shrink-0 border-b border-neutral-700/60 bg-neutral-800">
        <div data-tauri-drag-region className="h-[30px] flex items-center justify-center font-semibold text-[13px] pointer-events-none">
          {current.label}
        </div>
        <div data-tauri-drag-region role="tablist" className="flex justify-center gap-1 pb-1.5">
          {PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={pane === p.id}
              onClick={() => setPane(p.id)}
              className={`flex flex-col items-center justify-center gap-0.5 min-w-[64px] h-[46px] px-2 rounded-[8px] ${
                pane === p.id ? "bg-neutral-700/80 text-blue-500" : "text-neutral-400 hover:text-neutral-100"
              }`}
            >
              <SymbolIcon name={p.symbol} size={22} fallback={p.fallback} />
              <span className={`text-[11px] ${pane === p.id ? "text-neutral-100" : ""}`}>{p.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{content}</div>
    </Shell>
  );
}

function Shell({ children, column }: { children: ReactNode; column?: boolean }) {
  return (
    <div className={`flex ${column ? "flex-col" : ""} h-screen bg-neutral-900 text-neutral-100 text-[13px] select-none cursor-default`}>{children}</div>
  );
}
