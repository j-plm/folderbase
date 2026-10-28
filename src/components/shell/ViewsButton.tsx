import { useRef, useState } from "react";
import type React from "react";
import { useLocationViews } from "../../contexts/LocationViewsContext";
import { useBrowse } from "../../contexts/BrowseContext";
import { useDragReorder } from "../../hooks/useDragReorder";
import { moveColumnId } from "../../lib/columns";
import { SymbolIcon } from "../../lib/fileIcons";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";
import { uniqueViewName, workingDefinition, type StoredView } from "../../lib/tableViews";
import Dialog, { DialogButton } from "../shared/Dialog";
import Popover from "../shared/Popover";
import RenameField from "../shared/RenameField";

/**
 * The location's saved views, as a toolbar button shown in every view mode. It
 * opens a list of the views (as Notion lists a database's templates): pick one,
 * drag to reorder, and each one's ··· menu sets it as the default (the view the
 * location opens with), renames, duplicates or deletes it. New View copies
 * what's showing.
 */
export default function ViewsButton() {
  const tableViews = useLocationViews();
  const { active, edited } = tableViews;
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  /** Kept here, not in the popover: clicking the dialog closes the popover. */
  const [deleting, setDeleting] = useState<StoredView | null>(null);
  const named = !!active && !active.is_default;

  return (
    <div className="flex items-center gap-1 min-w-0">
      <button
        ref={button}
        onClick={() => setOpen((o) => !o)}
        title="Saved views of this location: filters, sorts, groups and folders"
        className={`flex items-center gap-1.5 h-[26px] px-2 max-w-[240px] rounded-md text-[13px] hover:bg-neutral-700/60 ${
          named ? "text-blue-400" : "text-neutral-300"
        } ${open ? "bg-neutral-700/60" : ""}`}
      >
        <SymbolIcon name="rectangle.stack" size={15} fallback="▤" />
        <span className="truncate">{active?.name ?? "View"}</span>
        {edited && <span className="text-neutral-500 shrink-0">— Edited</span>}
        <SymbolIcon name="chevron.down" size={9} fallback="▾" />
      </button>
      {/* Edits to a named view: save or revert them in one click (also File ▸ Save View, ⌘S) */}
      {edited && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => tableViews.revert().catch((e) => tableViews.reportError(String(e)))}
            title="Go back to the view as saved"
            className="h-[22px] px-2 rounded-md text-xs text-neutral-300 hover:bg-neutral-700/60"
          >
            Revert
          </button>
          <button
            onClick={() => tableViews.saveChanges().catch((e) => tableViews.reportError(String(e)))}
            title={`Save the changes to “${active?.name ?? ""}”`}
            className="h-[22px] px-2.5 rounded-md border border-blue-500/60 text-xs text-blue-400 hover:text-blue-300 hover:border-blue-400"
          >
            Save
          </button>
        </div>
      )}

      {open && button.current && (
        <ViewsPopover anchor={button.current} onClose={() => setOpen(false)} onDelete={setDeleting} />
      )}

      {deleting && (
        <Dialog
          title={`Delete “${deleting.name}”?`}
          message="The view is removed. Files and their values aren't changed."
          onCancel={() => setDeleting(null)}
          footer={
            <>
              <span className="flex-1" />
              <DialogButton onClick={() => setDeleting(null)}>Cancel</DialogButton>
              <DialogButton
                variant="destructive"
                onClick={() => {
                  const view = deleting;
                  setDeleting(null);
                  tableViews.remove(view.view_id).catch((e) => tableViews.reportError(String(e)));
                }}
              >
                Delete
              </DialogButton>
            </>
          }
        />
      )}
    </div>
  );
}

/** Marks the view a location opens with. */
export function DefaultBadge() {
  return (
    <span className="shrink-0 h-[18px] px-1.5 flex items-center rounded-[5px] bg-neutral-700/70 text-[11px] text-neutral-400">
      Default
    </span>
  );
}

/** The views, in order: click to show one, drag to reorder, ··· (or right-click) for its actions. */
function ViewsPopover({
  anchor,
  onClose,
  onDelete,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  onDelete: (view: StoredView) => void;
}) {
  const tableViews = useLocationViews();
  const { views, active, edited } = tableViews;
  const locationName = useBrowse()?.locationName;
  /** The view whose name is being edited in place. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(String(e));
  const taken = () => views.map((v) => v.name);

  const drag = useDragReorder(views.length, (from, gap) => {
    const ids = moveColumnId(
      views.map((v) => v.view_id),
      views[from].view_id,
      gap
    );
    tableViews.reorder(ids).catch((e) => {
      fail(e);
      void tableViews.reload();
    });
  });

  /** A copy of what's showing, named in place straight away. */
  async function newView() {
    setError(null);
    try {
      const id = await tableViews.saveAs(uniqueViewName("New View", taken()));
      if (id) setRenamingId(id);
    } catch (e) {
      fail(e);
    }
  }

  function commitRename(view: StoredView, text: string) {
    setRenamingId(null);
    const name = text.trim();
    if (!name || name === view.name) return;
    tableViews.rename(view.view_id, name).catch(fail);
  }

  function showMenu(e: React.MouseEvent, view: StoredView) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    const isEdited = view.view_id === active?.view_id && edited;
    void showContextMenu(
      [
        {
          type: "item",
          text: "Set as Default",
          enabled: !view.is_default,
          action: () => void tableViews.setDefault(view.view_id).catch(fail),
        },
        { type: "item", text: "Rename", action: () => setRenamingId(view.view_id) },
        {
          type: "item",
          text: "Duplicate",
          action: () => void tableViews.create(uniqueViewName(view.name, taken()), workingDefinition(view)).catch(fail),
        },
        ...(isEdited
          ? ([
              { type: "separator" },
              { type: "item", text: "Save Changes", action: () => void tableViews.saveChanges().catch(fail) },
              { type: "item", text: "Revert Changes", action: () => void tableViews.revert().catch(fail) },
            ] satisfies MenuEntry[])
          : []),
        { type: "separator" },
        // The default can't go: another is made default first
        {
          type: "item",
          text: "Delete View…",
          enabled: !view.is_default,
          action: () => {
            onClose();
            onDelete(view);
          },
        },
      ],
      { event: e }
    );
  }

  return (
    <Popover anchor={anchor} onClose={onClose} className="w-[300px] p-[5px]">
      <div className="h-6 flex items-center px-2 text-[11px] font-semibold text-neutral-500 truncate">
        {locationName ? `Views of ${locationName}` : "Views"}
      </div>
      {views.map((view, index) => {
        const selected = view.view_id === active?.view_id;
        const renaming = renamingId === view.view_id;
        return (
          <div
            key={view.view_id}
            ref={drag.itemRef(index)}
            onMouseDown={renaming ? undefined : (e) => drag.onMouseDown(e, index)}
            onClick={() => {
              if (renaming) return;
              void tableViews.select(view.view_id);
              onClose();
            }}
            onContextMenu={(e) => showMenu(e, view)}
            className={`group relative h-7 flex items-center gap-1.5 pl-0.5 pr-1 rounded-[6px] cursor-default ${
              selected ? "bg-neutral-700/70" : "hover:bg-neutral-700/40"
            } ${drag.drag?.from === index ? "opacity-50" : ""}`}
          >
            {drag.lineAt(index) && <DropLine edge="top" />}
            {drag.lineAt(index, true) && <DropLine edge="bottom" />}
            <span title="Drag to reorder" className="w-4 flex justify-center text-neutral-500 opacity-0 group-hover:opacity-100">
              <SymbolIcon name="line.3.horizontal" size={10} fallback="⋮⋮" />
            </span>
            <SymbolIcon name="rectangle.stack" size={14} fallback="▤" className={selected ? "text-blue-500" : "text-neutral-400"} />
            {renaming ? (
              <RenameField
                initial={view.name}
                label="View name"
                onCommit={(text) => commitRename(view, text)}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <>
                <span className={`flex-1 min-w-0 truncate ${selected ? "text-blue-500" : ""}`}>{view.name}</span>
                {selected && edited && <span className="shrink-0 text-xs text-neutral-500">Edited</span>}
                {view.is_default && <DefaultBadge />}
                <button
                  type="button"
                  title="More"
                  aria-label={`More for ${view.name}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => showMenu(e, view)}
                  className="w-5 h-5 shrink-0 flex items-center justify-center rounded-[5px] text-neutral-400 hover:bg-neutral-600/60 hover:text-neutral-100"
                >
                  <SymbolIcon name="ellipsis" size={12} fallback="···" />
                </button>
              </>
            )}
          </div>
        );
      })}
      {error && <p className="px-2 py-1 text-xs text-red-500">{error}</p>}
      <div className="mx-2 my-[5px] h-px bg-neutral-700/80" />
      <button
        type="button"
        onClick={() => void newView()}
        title="A new view of what's showing"
        className="w-full h-7 flex items-center gap-1.5 pl-[22px] pr-2 rounded-[6px] text-left text-neutral-400 hover:bg-neutral-700/40 hover:text-neutral-100"
      >
        <SymbolIcon name="plus" size={12} fallback="+" />
        New View
      </button>
    </Popover>
  );
}

/** Where a dragged view will land. */
function DropLine({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-1 right-1 z-10 h-[2px] rounded-full bg-blue-500"
      style={{ [edge]: -1.5 }}
    />
  );
}

/** The views as an overflow-menu submenu, for when the toolbar is too narrow for the button. */
export function viewsSubmenu(tableViews: ReturnType<typeof useLocationViews>): MenuEntry {
  return {
    type: "submenu",
    text: "View",
    items: [
      ...tableViews.views.map(
        (v): MenuEntry => ({
          type: "check",
          text: v.name,
          checked: v.view_id === tableViews.active?.view_id,
          action: () => void tableViews.select(v.view_id),
        })
      ),
      // The Save and Revert buttons go with the view button when the toolbar is narrow
      ...(tableViews.edited
        ? ([
            { type: "separator" },
            { type: "item", text: "Save Changes", action: () => void tableViews.saveChanges() },
            { type: "item", text: "Revert Changes", action: () => void tableViews.revert() },
          ] satisfies MenuEntry[])
        : []),
    ],
  };
}
