import { useSyncExternalStore } from "react";
import { compressJobs, type CompressJob } from "../../lib/compressActions";
import { FileIcon, SymbolIcon } from "../../lib/fileIcons";
import { showContextMenu, type MenuEntry } from "../../lib/nativeMenu";
import { labels } from "../../lib/platform";
import { appSettings, folderName } from "../../lib/appSettings";

/**
 * A notice per zip being made, in the window's bottom corner, laid out as a
 * macOS notification banner: icon, name, a grey line, and one button (Cancel
 * while it runs, then Show in Finder). Where zips go is a quiet pop-up on the
 * folder's name ("Saved in Downloads ⌄"), and in the notice's right-click menu,
 * as Safari keeps a download's other actions off the row. The close button
 * shows at the top left on hover; hovering also keeps it from going by itself.
 */
export default function CompressNotices() {
  const jobs = useSyncExternalStore(compressJobs.subscribe, compressJobs.snapshot);
  if (jobs.length === 0) return null;
  return (
    <div className="absolute right-3 bottom-12 z-40 flex flex-col gap-2 w-[320px] pointer-events-none">
      {jobs.map((job) => (
        <Notice key={job.id} job={job} />
      ))}
    </div>
  );
}

/** Where zips go: change it here, or in Settings. */
function folderEntries(job: CompressJob): MenuEntry[] {
  return [
    { type: "item", text: "Change Default Folder…", action: () => void compressJobs.changeFolder(job.id) },
    { type: "item", text: "Settings…", action: () => appSettings.setOpen(true) },
  ];
}

function Notice({ job }: { job: CompressJob }) {
  const fraction = job.total > 0 ? Math.min(1, job.done / job.total) : 0;
  const folder = job.path?.split(/[\\/]/).slice(-2, -1)[0];
  const done = job.state === "done" && !!job.path;

  const menu = (e: React.MouseEvent) => {
    if (!done) return;
    e.preventDefault();
    e.stopPropagation();
    compressJobs.keep(job.id);
    void showContextMenu(
      [{ type: "item", text: labels.reveal, action: () => compressJobs.reveal(job.path!) }, { type: "separator" }, ...folderEntries(job)],
      { event: e }
    );
  };
  // Opens at the pointer, which is on the folder's name
  const folderMenu = () => {
    compressJobs.keep(job.id);
    void showContextMenu(folderEntries(job));
  };

  return (
    <div
      onMouseEnter={() => done && compressJobs.keep(job.id)}
      onContextMenu={menu}
      className="group relative pointer-events-auto flex items-center gap-2.5 pl-3 pr-3 py-2.5 rounded-2xl border border-neutral-700/60 bg-neutral-800 shadow-lg text-[13px] select-none"
    >
      {job.state !== "running" && (
        <button
          type="button"
          aria-label="Close"
          onClick={() => compressJobs.dismiss(job.id)}
          className="absolute -left-1.5 -top-1.5 w-5 h-5 flex items-center justify-center rounded-full border border-neutral-700/60 bg-neutral-800 shadow text-neutral-400 hover:text-neutral-100 opacity-0 group-hover:opacity-100"
        >
          <SymbolIcon name="xmark" size={8} fallback={<span className="text-[9px] leading-none">✕</span>} />
        </button>
      )}
      <FileIcon path={job.name} mimeType="application/zip" size={32} />
      <div className="flex-1 min-w-0">
        <div className="truncate font-semibold text-neutral-100">
          {job.state === "running" ? `Compressing “${job.name}”` : job.state === "done" ? job.name : "Couldn’t compress"}
        </div>
        {job.state === "running" && (
          <div className="mt-1.5 h-1 rounded-full bg-neutral-700 overflow-hidden">
            <div className="h-full bg-blue-500 transition-[width]" style={{ width: `${fraction * 100}%` }} />
          </div>
        )}
        {done && !job.changedTo && (
          <div className="flex items-center text-neutral-400 whitespace-nowrap min-w-0">
            <span className="shrink-0">Saved in&nbsp;</span>
            <button
              type="button"
              onClick={folderMenu}
              title="Change where zips are saved"
              className="inline-flex items-center gap-0.5 min-w-0 rounded hover:text-neutral-200"
            >
              <span className="truncate">{folder}</span>
              <SymbolIcon name="chevron.down" size={8} fallback="▾" />
            </button>
          </div>
        )}
        {done && job.changedTo && (
          <div className="truncate text-neutral-400">Next zips go to “{folderName(job.changedTo)}”</div>
        )}
        {job.state === "failed" && <div className="text-neutral-400 break-words">{job.error}</div>}
      </div>
      {job.state === "running" && <PushButton onClick={() => compressJobs.cancel(job.id)}>Cancel</PushButton>}
      {done && <PushButton onClick={() => compressJobs.reveal(job.path!)}>{labels.reveal}</PushButton>}
    </div>
  );
}

/** The banner's one button, a small push button as notifications have. */
function PushButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 whitespace-nowrap h-[22px] px-2.5 rounded-[6px] bg-neutral-700/70 text-[12px] text-neutral-100 active:bg-neutral-700"
    >
      {children}
    </button>
  );
}
