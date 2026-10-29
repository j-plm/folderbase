import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type React from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { dragOut, importFiles, setEditMenuLabels, setMetadataCells, trashAddedFiles } from "../lib/commands";
import { setUndoTarget } from "../lib/editMenu";
import { planDrop, folderLabel, type DragItem, type DropContext, type DropOptions, type DropPlan } from "../lib/filing";
import { DRAG_ICON_OFFSET, DRAG_ICON_SIZE, HOLDING_FOLDER, edgeScroll } from "../lib/fileDrag";
import { DRAG_THRESHOLD } from "../lib/tagDrag";
import { dropPositionScale, platform } from "../lib/platform";
import { FileIcon, FolderIcon } from "../lib/fileIcons";
import { useUndo } from "../hooks/useUndo";
import { useBrowse } from "./BrowseContext";
import Dialog, { DialogButton, DialogField, dialogTextField } from "../components/shared/Dialog";
import type { FileRecord } from "../types";

// Filing by drag in Icons, List and Columns (spec ▸ Multi-folder Presence):
// files and folders are dragged onto folders, whose values they take
// (lib/filing works out what changes). Dragged out of the window, they become
// a system drag, so they can be dropped into Finder or another app; dropped in
// from another app, they're copied into the location and filed the same way.
//
// Drop targets are marked in the DOM: `data-drop-path` (the folder's path as
// JSON) on folders, path bar segments and each view's background
// (`data-drop-kind="area"`, the folder showing there). A target in another
// hierarchy than the view's folders (the Database view's own groups) names it
// with `data-drop-source`, registered with `registerSource`.

/** How long a dragged item rests on a folder before it opens, as Finder's spring-loaded folders do. */
const SPRING_MS = 1000;

/** What the drag would do, for the cursor and the bar along the bottom. */
export interface DropStatus {
  title: string;
  details: string[];
  /** Nothing can go there: `title` says why. */
  refused: boolean;
}

/** A hierarchy other than the view's folders that drop targets can belong to (the Database view's groups). */
export interface DropSource {
  context: () => DropContext | null;
  /** Where a file sits in it, as the place it's dragged from (null: nowhere in particular). */
  fromOf: (file: FileRecord) => string[] | null;
}

export interface FileDragValue {
  /**
   * Watches a press on an item: past a few points of travel it becomes a
   * drag of what `items` returns then (read at that moment, so it can select
   * the item first).
   */
  press: (e: React.PointerEvent, items: () => DragItem[]) => void;
  /** The drop under the pointer, while dragging over a folder. */
  status: DropStatus | null;
  /** Files `items` into the folder at `to` as a drop would (Remove from “Folder” files into the enclosing one). */
  fileInto: (items: DragItem[], to: string[], opts?: DropOptions) => void;
  /** Makes targets marked `data-drop-source={name}` file into `source`'s hierarchy; returns a function that removes it. */
  registerSource: (name: string, source: DropSource) => () => void;
  /** The location's change history, which Edit ▸ Undo reaches in every view mode (the Database view records its edits here too). */
  history: UndoHistoryApi;
}

export type UndoHistoryApi = ReturnType<typeof useUndo>;

const FileDragContext = createContext<FileDragValue | null>(null);

interface Hover {
  path: string[];
  el: HTMLElement;
  /** A view's background (the folder showing), rather than a folder in it. */
  area: boolean;
  /** The hierarchy it belongs to (`registerSource`); left out: the view's folders. */
  source?: string;
}

interface Session {
  items: DragItem[];
  /** Option is held: a Multi-select gains the value. */
  add: boolean;
  hover: Hover | null;
  plan: DropPlan | null;
  x: number;
  y: number;
  /** Dragged in from another app: its paths, and how many aren't in the location yet. */
  external?: { paths: string[]; fresh: number };
}

/** A drop waiting on the user: which day for a date folder, or whether to replace values. */
type Pending =
  | { kind: "date"; plan: DropPlan; settle: (dates: Record<string, string> | null) => void }
  | {
      kind: "replace";
      plan: DropPlan;
      /** The plan without the replacements (Keep Existing), when it still files something. */
      keep: DropPlan | null;
      settle: (chosen: "replace" | "keep" | null) => void;
    };

/** Writes a drop's plan (made with `opts`), as a change that can be undone. */
type Commit = (plan: DropPlan, opts: DropOptions) => Promise<void>;

/** A plan that files nothing: a drop cancelled after files were copied in still needs undoing. */
const nothingFrom = (plan: DropPlan): DropPlan => ({ ...plan, edits: [], before: [], files: 0, replacements: [], asks: [] });

/**
 * Scrolls what's under (x, y) when it's near the edge of an area that
 * scrolls: the nearest one that can go that way (a column's list up and down,
 * the row of columns sideways). Whether anything moved.
 */
function scrollUnder(x: number, y: number): boolean {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  let moved = false;
  let wantX = true;
  let wantY = true;
  for (; el && (wantX || wantY); el = el.parentElement) {
    const style = getComputedStyle(el);
    const canY = wantY && /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    const canX = wantX && /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
    if (!canX && !canY) continue;
    const { dx, dy } = edgeScroll(el.getBoundingClientRect(), x, y);
    if (canY && dy !== 0) {
      wantY = false;
      if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight) {
        el.scrollTop += dy;
        moved = true;
      }
    }
    if (canX && dx !== 0) {
      wantX = false;
      if (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth) {
        el.scrollLeft += dx;
        moved = true;
      }
    }
  }
  return moved;
}

const sameFiles = (a: string[], b: Set<string>) => a.length > 0 && a.every((p) => b.has(p));

/** The files dragged: each file, and every file in each folder. */
function filesOf(items: DragItem[], filesAt: (path: string[]) => FileRecord[]): FileRecord[] {
  const seen = new Map<string, FileRecord>();
  for (const item of items) {
    for (const f of item.kind === "file" ? [item.file] : filesAt(item.path)) seen.set(f.file_id, f);
  }
  return [...seen.values()];
}

export function FileDragProvider({ locationId, children }: { locationId: string | null; children: ReactNode }) {
  const browse = useBrowse();
  const browseRef = useRef(browse);
  browseRef.current = browse;

  const [status, setStatus] = useState<DropStatus | null>(null);
  /** What's being dragged, and where the drag started (the ghost then follows the pointer directly). */
  const [ghost, setGhost] = useState<{ items: DragItem[]; x: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const session = useRef<Session | null>(null);
  const springTimer = useRef<number | undefined>(undefined);
  /** A drag handed to the system, so files dropped back on the window are known for what they were. */
  const handedOff = useRef<{ items: DragItem[]; paths: Set<string> } | null>(null);
  const endDrag = useRef<() => void>(() => {});
  const sources = useRef(new Map<string, DropSource>());
  const registerSource = useCallback((name: string, source: DropSource) => {
    sources.current.set(name, source);
    return () => {
      if (sources.current.get(name) === source) sources.current.delete(name);
    };
  }, []);

  /**
   * What a drop on a target is worked out against: its hierarchy, and the
   * items as dragged from there (files only, for another hierarchy).
   */
  const resolve = useCallback((items: DragItem[], source: string | undefined): { ctx: DropContext; items: DragItem[] } | null => {
    if (!source) {
      const ctx = browseRef.current?.dropContext;
      return ctx ? { ctx, items } : null;
    }
    const src = sources.current.get(source);
    const ctx = src?.context();
    if (!src || !ctx) return null;
    return {
      ctx,
      items: items.flatMap((i): DragItem[] => (i.kind === "file" ? [{ ...i, from: i.from === null ? null : src.fromOf(i.file) }] : [])),
    };
  }, []);

  // ── Undo: one history for the location, in every view mode ──────────────────

  const history = useUndo(
    locationId,
    (e) => setNotice({ title: "The change couldn't be undone", message: String(e) }),
    (h) => setEditMenuLabels(h.past[h.past.length - 1]?.label ?? null, h.future[h.future.length - 1]?.label ?? null).catch(() => {})
  );
  const { undo, redo, queue, push } = history;
  const historyApi = useMemo(() => ({ undo, redo, queue, push }), [undo, redo, queue, push]);
  useEffect(() => setUndoTarget({ undo, redo }), [undo, redo]);

  const commitPlan: Commit = useCallback(
    async (plan) => {
      if (plan.edits.length === 0) return;
      const write = async (edits: DropPlan["edits"]) => {
        await setMetadataCells(edits);
        await browseRef.current?.refresh();
      };
      try {
        await queue(() => write(plan.edits));
        push({ label: plan.verb, undo: () => write(plan.before), redo: () => write(plan.edits) });
      } catch (e) {
        setNotice({ title: "The files couldn't be filed", message: String(e) });
      }
    },
    [queue, push]
  );

  /**
   * Settles a drop: asks which day for a date folder spanning several, then
   * whether to replace values the user couldn't see, then commits what's chosen.
   * `replan` works the plan out again with those answers.
   */
  const finish = useCallback(
    (replan: (extra: DropOptions) => DropPlan, commit: Commit, then?: () => void) => {
      const done = (plan: DropPlan, opts: DropOptions) => void commit(plan, opts).then(then);
      const settle = (dates?: Record<string, string>) => {
        const opts: DropOptions = { dates };
        const plan = replan(opts);
        if (plan.asks.length > 0 && !dates) {
          setPending({ kind: "date", plan, settle: (chosen) => (chosen ? settle(chosen) : done(nothingFrom(plan), opts)) });
          return;
        }
        if (plan.replacements.length > 0) {
          const keep = replan({ ...opts, replace: false });
          setPending({
            kind: "replace",
            plan,
            keep: keep.files > 0 ? keep : null,
            settle: (chosen) =>
              chosen === "replace"
                ? done(plan, opts)
                : chosen === "keep"
                  ? done(keep, { ...opts, replace: false })
                  : done(nothingFrom(plan), opts),
          });
          return;
        }
        done(plan, opts);
      };
      settle();
    },
    []
  );

  const fileInto = useCallback(
    (items: DragItem[], to: string[], opts: DropOptions = {}) => {
      const ctx = browseRef.current?.dropContext;
      if (ctx) finish((extra) => planDrop(items, to, ctx, { ...opts, ...extra }), commitPlan);
    },
    [finish, commitPlan]
  );

  // ── Where the pointer is ───────────────────────────────────────────────

  const describe = useCallback((s: Session) => {
    const hover = s.hover;
    hover?.el.removeAttribute("data-drop-over");
    s.plan = null;
    const resolved = hover ? resolve(s.items, hover.source) : null;
    if (!hover || !resolved) {
      setStatus(null);
      return;
    }
    const { ctx, items } = resolved;
    let show: DropStatus | null;
    let fileable: boolean;
    if (s.external && s.external.fresh > 0) {
      // Copied in: they'll take the folder's values that can be set, whatever else they hold
      const blank: FileRecord = { file_id: "", file_path: "", file_type: null, timestamp: null, library: null, metadata: {}, tags: [] };
      const preview = planDrop([{ kind: "file", file: blank, from: null }], hover.path, ctx, { partial: true });
      const where = `${s.external.fresh} copied into “${browseRef.current?.addedFolder ?? HOLDING_FOLDER}”`;
      show = { title: `Copy to “${folderLabel(ctx.tree, hover.path, ctx.topLabel)}”`, details: [where, ...preview.details], refused: false };
      fileable = true;
    } else {
      const plan = planDrop(items, hover.path, ctx, { add: s.add });
      s.plan = plan;
      fileable = plan.files > 0;
      show = plan.refusal
        ? { title: plan.refusal, details: [], refused: true }
        : fileable
          ? { title: plan.title, details: plan.details, refused: false }
          : null;
    }
    if (fileable) hover.el.setAttribute("data-drop-over", hover.area ? "area" : "item");
    setStatus(show);
  }, [resolve]);

  const hoverAt = useCallback(
    (x: number, y: number, force = false) => {
      const s = session.current;
      if (!s) return;
      s.x = x;
      s.y = y;
      const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop-path]") ?? null;
      if (!force && el === (s.hover?.el ?? null)) return;
      s.hover?.el.removeAttribute("data-drop-over");
      window.clearTimeout(springTimer.current);
      let path: string[] | null = null;
      try {
        path = el ? (JSON.parse(el.dataset.dropPath ?? "") as string[]) : null;
      } catch {
        path = null;
      }
      s.hover = el && path ? { path, el, area: el.dataset.dropKind === "area", source: el.dataset.dropSource } : null;
      describe(s);
      // Resting on a folder opens it, so a drag can go deeper (not a table group: it's no folder)
      const hover = s.hover;
      if (hover && !hover.area && !hover.source) {
        springTimer.current = window.setTimeout(() => {
          if (session.current !== s) return;
          browseRef.current?.go(hover.path);
          requestAnimationFrame(() => hoverAt(s.x, s.y, true));
        }, SPRING_MS);
      }
    },
    [describe]
  );

  // While a drag lasts, an area scrolls when the pointer nears its edge, and what's under the pointer is
  // looked at again as the content moves under it (as Finder's lists and columns do)
  const scrollFrame = useRef<number | undefined>(undefined);
  const autoScroll = useCallback(() => {
    const step = () => {
      const s = session.current;
      if (!s) return;
      if (scrollUnder(s.x, s.y)) hoverAt(s.x, s.y);
      scrollFrame.current = requestAnimationFrame(step);
    };
    if (scrollFrame.current != null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(step);
  }, [hoverAt]);

  const end = useCallback(() => {
    endDrag.current();
    endDrag.current = () => {};
    if (scrollFrame.current != null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = undefined;
    window.clearTimeout(springTimer.current);
    session.current?.hover?.el.removeAttribute("data-drop-over");
    session.current = null;
    setGhost(null);
    setStatus(null);
  }, []);

  // ── Dragging items in the window ──────────────────────────────────────────

  const begin = useCallback(
    (items: DragItem[], ev: PointerEvent) => {
      const s: Session = { items, add: ev.altKey, hover: null, plan: null, x: ev.clientX, y: ev.clientY };
      session.current = s;
      setGhost({ items, x: ev.clientX, y: ev.clientY });
      // No text is selected along the way
      const userSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      const filesAt = (path: string[]) => browseRef.current?.tree?.filesAt(path) ?? [];

      const place = (x: number, y: number) => {
        if (ghostRef.current) ghostRef.current.style.transform = `translate(${x + DRAG_ICON_OFFSET}px, ${y + DRAG_ICON_OFFSET}px)`;
      };
      /** Out of the window: the system carries the drag on, to Finder or another app. */
      const handOff = () => {
        const files = filesOf(s.items, filesAt).filter((f) => !!f.file_path);
        end();
        if (files.length === 0) return;
        const paths = files.map((f) => f.file_path);
        handedOff.current = { items: s.items, paths: new Set(paths) };
        dragOut(paths, DRAG_ICON_SIZE, DRAG_ICON_OFFSET).catch(() => {});
      };
      const onMove = (e: PointerEvent) => {
        if (e.clientX < 0 || e.clientY < 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
          handOff();
          return;
        }
        place(e.clientX, e.clientY);
        if (e.altKey !== s.add) {
          s.add = e.altKey;
          describe(s);
        }
        hoverAt(e.clientX, e.clientY);
      };
      const onUp = () => {
        const { hover, plan } = s;
        end();
        // The click that ends a drag isn't a click on what's under it
        const swallow = (e: MouseEvent) => e.stopPropagation();
        window.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
        const resolved = hover && resolve(s.items, hover.source);
        if (!hover || !plan || plan.files === 0 || !resolved) return;
        finish((extra) => planDrop(resolved.items, hover.path, resolved.ctx, { add: s.add, ...extra }), commitPlan);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          end();
        } else if (e.key === "Alt" && e.altKey !== s.add) {
          s.add = e.altKey;
          describe(s);
        }
      };
      const onLeave = () => handOff();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      document.documentElement.addEventListener("mouseleave", onLeave);
      endDrag.current = () => {
        document.body.style.userSelect = userSelect;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onKey);
        document.documentElement.removeEventListener("mouseleave", onLeave);
      };
      place(ev.clientX, ev.clientY);
      hoverAt(ev.clientX, ev.clientY);
      autoScroll();
    },
    [describe, end, finish, commitPlan, hoverAt, resolve, autoScroll]
  );

  const press = useCallback(
    (e: React.PointerEvent, items: () => DragItem[]) => {
      // Control-click is a right-click on macOS
      if (e.button !== 0 || (platform === "macos" && e.ctrlKey) || session.current) return;
      const start = { x: e.clientX, y: e.clientY };
      const onMove = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
        stop();
        const list = items();
        if (list.length > 0) begin(list, ev);
      };
      const stop = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
    },
    [begin]
  );

  // ── Dragged in from another app (or back in from outside the window) ────────

  const dropIn = useCallback(
    async (paths: string[], to: string[], source: string | undefined) => {
      if (!locationId) return;
      handedOff.current = null;
      try {
        const imported = await importFiles(locationId, paths);
        let { copies, folder } = imported;
        const isCopy = (p: string) => copies.some((c) => p === c || p.startsWith(`${c}/`));
        /** The dropped files' records, once indexed. */
        const itemsFor = (files: string[], records: FileRecord[]): DragItem[] => {
          const byPath = new Map(records.map((f) => [f.file_path, f]));
          return files.flatMap((p): DragItem[] => (byPath.has(p) ? [{ kind: "file", file: byPath.get(p)!, from: null }] : []));
        };
        const fresh = (await browseRef.current?.refresh()) ?? [];
        const items = itemsFor(imported.files, fresh);
        const copyIds = new Set(items.flatMap((i) => (i.kind === "file" && isCopy(i.file.file_path) ? [i.file.file_id] : [])));
        const ctx = resolve([], source)?.ctx;
        if (!ctx) return;
        const base: DropOptions = { partial: true };

        // Undone, the copies go to the Trash (and files already in the location get their values back);
        // redone, they're copied in and filed again
        const commit: Commit = async (plan, opts) => {
          const restore = plan.before.filter((e) => !copyIds.has(e.file_id));
          const refresh = async () => (await browseRef.current?.refresh()) ?? [];
          try {
            if (plan.edits.length > 0) {
              await queue(async () => {
                await setMetadataCells(plan.edits);
                await refresh();
              });
            }
            if (copies.length === 0 && plan.edits.length === 0) return;
            push({
              label: "Add",
              undo: async () => {
                if (restore.length > 0) await setMetadataCells(restore);
                if (copies.length > 0) await trashAddedFiles(locationId, folder, copies);
                await refresh();
              },
              redo: async () => {
                const again = await importFiles(locationId, paths);
                ({ copies, folder } = again);
                const now = resolve([], source)?.ctx;
                const replanned = now ? planDrop(itemsFor(again.files, await refresh()), to, now, { ...base, ...opts }) : null;
                if (replanned && replanned.edits.length > 0) await setMetadataCells(replanned.edits);
                await refresh();
              },
            });
          } catch (e) {
            setNotice({ title: "The files couldn't be filed", message: String(e) });
          }
        };
        const left = () => {
          const plan = planDrop(items, to, ctx, base);
          if (copies.length === 0 || !plan.left) return;
          setNotice({
            title: `${plan.left.count} of ${items.length} ${items.length === 1 ? "file isn't" : "files aren't"} in “${folderLabel(ctx.tree, to, ctx.topLabel)}”`,
            message: `They were copied into “${browseRef.current?.addedFolder ?? HOLDING_FOLDER}” with the values that could be set, but ${plan.left.reason}.`,
          });
        };
        finish((extra) => planDrop(items, to, ctx, { ...base, ...extra }), commit, left);
      } catch (e) {
        setNotice({ title: "The files couldn't be added", message: String(e) });
      }
    },
    [locationId, finish, queue, push, resolve]
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    const at = (p: { x: number; y: number }) => [p.x / dropPositionScale(), p.y / dropPositionScale()] as const;
    getCurrentWindow()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          if (session.current && !session.current.external) return;
          const files = browseRef.current?.files ?? [];
          const byPath = new Map(files.map((f) => [f.file_path, f]));
          const back = handedOff.current;
          const known = back && sameFiles(payload.paths, back.paths) ? back.items : null;
          const items =
            known ?? payload.paths.flatMap((p): DragItem[] => (byPath.has(p) ? [{ kind: "file", file: byPath.get(p)!, from: null }] : []));
          const fresh = payload.paths.filter((p) => !byPath.has(p)).length;
          session.current = { items, add: false, hover: null, plan: null, x: 0, y: 0, external: { paths: payload.paths, fresh } };
          hoverAt(...at(payload.position));
          autoScroll();
        } else if (payload.type === "over") {
          if (session.current?.external) hoverAt(...at(payload.position));
        } else if (payload.type === "leave") {
          if (session.current?.external) end();
        } else if (payload.type === "drop") {
          const s = session.current;
          if (!s?.external) return;
          const { hover, plan, items, external } = s;
          end();
          if (!hover) return;
          // All already in the location (or dragged out and back): filed as they are, nothing copied
          if (external.fresh === 0) {
            handedOff.current = null;
            const resolved = resolve(items, hover.source);
            if (plan && plan.files > 0 && resolved) finish((extra) => planDrop(resolved.items, hover.path, resolved.ctx, extra), commitPlan);
          } else {
            void dropIn(payload.paths, hover.path, hover.source);
          }
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [hoverAt, end, dropIn, finish, commitPlan, resolve, autoScroll]);

  useEffect(() => end, [end]);

  const value = useMemo(
    () => ({ press, status, fileInto, registerSource, history: historyApi }),
    [press, status, fileInto, registerSource, historyApi]
  );

  const lead = ghost?.items[0];
  return (
    <FileDragContext.Provider value={value}>
      {children}
      {ghost &&
        lead &&
        createPortal(
          <div
            ref={ghostRef}
            style={{ transform: `translate(${ghost.x + DRAG_ICON_OFFSET}px, ${ghost.y + DRAG_ICON_OFFSET}px)` }}
            className="fixed left-0 top-0 z-[60] pointer-events-none flex flex-col items-start gap-1"
          >
            <div className="relative opacity-80">
              {lead.kind === "file" ? <FileIcon path={lead.file.file_path} mimeType={lead.file.file_type} size={DRAG_ICON_SIZE} /> : <FolderIcon size={DRAG_ICON_SIZE} />}
              {ghost.items.length > 1 && (
                <span className="absolute -top-1 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-semibold leading-[18px] text-center">
                  {ghost.items.length}
                </span>
              )}
            </div>
            {status && (
              <span
                className={`px-1.5 py-0.5 rounded-[5px] text-xs whitespace-nowrap shadow-md bg-neutral-800 border border-neutral-700/60 ${
                  status.refused ? "text-neutral-400" : "text-neutral-100"
                }`}
              >
                {status.title}
              </span>
            )}
          </div>,
          document.body
        )}
      {pending?.kind === "replace" && (
        <ReplaceSheet
          pending={pending}
          onChoose={(chosen) => {
            setPending(null);
            pending.settle(chosen);
          }}
        />
      )}
      {pending?.kind === "date" && (
        <DateSheet
          plan={pending.plan}
          onChoose={(dates) => {
            setPending(null);
            pending.settle(dates);
          }}
        />
      )}
      {notice && (
        <Dialog
          title={notice.title}
          message={notice.message}
          onCancel={() => setNotice(null)}
          onSubmit={() => setNotice(null)}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton variant="default" autoFocus>
                OK
              </DialogButton>
            </>
          }
        />
      )}
    </FileDragContext.Provider>
  );
}

/** Before a drop writes over values the user couldn't see from where they dragged: Replace, Keep Existing or Cancel. */
function ReplaceSheet({
  pending,
  onChoose,
}: {
  pending: Extract<Pending, { kind: "replace" }>;
  onChoose: (chosen: "replace" | "keep" | null) => void;
}) {
  const { plan, keep } = pending;
  // "2 files already have a different Client: Acme (2)"
  const byLevel = new Map<string, Map<string, number>>();
  for (const r of plan.replacements) {
    const was = byLevel.get(r.level) ?? new Map<string, number>();
    was.set(r.was, (was.get(r.was) ?? 0) + 1);
    byLevel.set(r.level, was);
  }
  const lines = [...byLevel].map(([level, was]) => {
    const n = [...was.values()].reduce((a, b) => a + b, 0);
    const values = [...was].map(([v, count]) => (count > 1 ? `${v} (${count})` : v)).join(", ");
    return `${n} ${n === 1 ? "file already has" : "files already have"} a different ${level}: ${values}.`;
  });
  const count = plan.replacements.length;
  return (
    <Dialog
      title={count === 1 ? `Replace ${plan.replacements[0].level}?` : `Replace ${count} values?`}
      message={
        <>
          {lines.join(" ")} {plan.title} replaces {count === 1 ? "it" : "them"}.
        </>
      }
      onCancel={() => onChoose(null)}
      onSubmit={() => onChoose("replace")}
      footer={
        <>
          <span className="flex-1" />
          <DialogButton onClick={() => onChoose(null)}>Cancel</DialogButton>
          {keep && <DialogButton onClick={() => onChoose("keep")}>Keep Existing</DialogButton>}
          <DialogButton variant="default" autoFocus>
            Replace
          </DialogButton>
        </>
      }
    />
  );
}

/** Dropped on a date folder spanning several days (a month, a year): which day the files get. */
function DateSheet({ plan, onChoose }: { plan: DropPlan; onChoose: (dates: Record<string, string> | null) => void }) {
  const [dates, setDates] = useState<Record<string, string>>(() =>
    Object.fromEntries(plan.asks.map((a) => [a.column, a.first]))
  );
  const valid = plan.asks.every((a) => (dates[a.column] ?? "") >= a.first && (dates[a.column] ?? "") <= a.last);
  const only = plan.asks.length === 1 ? plan.asks[0] : null;
  return (
    <Dialog
      title={only ? `Which day in “${only.folder}”?` : "Which days?"}
      message={`${plan.files === 1 ? "The file gets" : `The ${plan.files} files get`} the day chosen${only ? ` as its ${only.level}` : ""}.`}
      onCancel={() => onChoose(null)}
      onSubmit={() => valid && onChoose(dates)}
      footer={
        <>
          <span className="flex-1" />
          <DialogButton onClick={() => onChoose(null)}>Cancel</DialogButton>
          <DialogButton variant="default" disabled={!valid}>
            {plan.verb}
          </DialogButton>
        </>
      }
    >
      {plan.asks.map((a, i) => (
        <DialogField key={a.column} label={a.level}>
          <input
            type="date"
            autoFocus={i === 0}
            min={a.first}
            max={a.last}
            value={dates[a.column] ?? ""}
            onChange={(e) => setDates((d) => ({ ...d, [a.column]: e.target.value }))}
            className={dialogTextField}
          />
        </DialogField>
      ))}
    </Dialog>
  );
}

/** Filing by drag, where a location's folders show (null elsewhere). */
export function useFileDrag(): FileDragValue | null {
  return useContext(FileDragContext);
}
