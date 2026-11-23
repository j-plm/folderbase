import { listen } from "@tauri-apps/api/event";
import { quickLook, quickLookUpdate, type IconFrame } from "./commands";

// Quick Look (Space): the system panel previews the selected files (commands/quick_look.rs).
// While it's open it follows the selection, and with one file previewed its
// arrow keys come back here to move the selection in the view showing.

export interface PreviewTargets {
  /** The files to preview, in display order. */
  paths: string[];
  /** Which one the panel starts on. */
  index: number;
}

/**
 * What Space previews: the selected items in display order that are files
 * (virtual folders have nothing on disk to preview), starting at `focus`, the
 * item last clicked or moved to, when it's one of them.
 */
export function previewTargets(
  ids: string[],
  pathOf: (id: string) => string | undefined,
  focus: string | null = null
): PreviewTargets {
  const paths: string[] = [];
  let index = 0;
  for (const id of ids) {
    const path = pathOf(id);
    if (!path) continue;
    if (id === focus) index = paths.length;
    paths.push(path);
  }
  return { paths, index };
}

/**
 * Where each file's icon is on the page, for the panel to zoom out of and back
 * into: the first icon marked `data-icon-of` the file's path that can be seen
 * (not scrolled away or covered), else null and the panel fades instead.
 */
export function iconFrames(paths: string[], root: ParentNode = document): IconFrame[] {
  const wanted = new Set(paths);
  const found = new Map<string, IconFrame>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-icon-of]")) {
    const path = el.dataset.iconOf;
    if (!path || !wanted.has(path) || found.has(path)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || !seen(el, r)) continue;
    found.set(path, { x: r.left, y: r.top, width: r.width, height: r.height });
  }
  return paths.map((p) => found.get(p) ?? null);
}

/** Whether the middle of `el` is on screen and nothing covers it (a row scrolled out of its list is covered). */
function seen(el: HTMLElement, r: DOMRect): boolean {
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === el || el.contains(hit));
}

let open = false;
let showing = "";
const key = (paths: string[]) => paths.join("\n");

/** Space: opens the panel on `paths`, or closes it when it's already showing them. */
export async function toggleQuickLook({ paths, index }: PreviewTargets): Promise<void> {
  if (paths.length === 0) return;
  showing = key(paths);
  open = await quickLook(paths, index, iconFrames(paths)).catch(() => false);
}

/** The selection changed: the open panel shows the new files. Nothing happens while it's closed. */
export function followSelection({ paths, index }: PreviewTargets): void {
  if (!open || paths.length === 0 || key(paths) === showing) return;
  showing = key(paths);
  void quickLookUpdate(paths, index, iconFrames(paths))
    .then((stillOpen) => (open = stillOpen))
    .catch(() => (open = false));
}

/** An arrow pressed in the panel moves the selection in the view showing, as if pressed there. */
function sendToView(arrow: string) {
  const view = document.querySelector<HTMLElement>("[data-browse-keys]");
  view?.dispatchEvent(new KeyboardEvent("keydown", { key: arrow, code: arrow, bubbles: true, cancelable: true }));
}

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  void listen("quick_look_closed", () => {
    open = false;
    showing = "";
  });
  void listen<string>("quick_look_key", (e) => sendToView(e.payload));
}
