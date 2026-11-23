import { useEffect, useSyncExternalStore } from "react";
import { backupJobs, type BackupJob } from "../../lib/backupActions";
import { FileIcon, SymbolIcon } from "../../lib/fileIcons";
import { labels } from "../../lib/platform";
import { ProgressBar } from "../shared/Progress";
import { NOTICE_CLASS, PushButton } from "./Notice";

/**
 * A notice per backup of the database, in the corner stack with zips and
 * refreshes: a sweeping bar while it's made (there's no useful total), then the
 * backup's name with Show in Finder. Automatic backups make no notice.
 */
export default function BackupNotices() {
  const jobs = useSyncExternalStore(backupJobs.subscribe, backupJobs.snapshot);
  useEffect(() => {
    const stop = backupJobs.listen();
    return () => void stop.then((f) => f());
  }, []);
  return (
    <>
      {jobs.map((job) => (
        <Notice key={job.id} job={job} />
      ))}
    </>
  );
}

function Notice({ job }: { job: BackupJob }) {
  const name = job.path?.split(/[\\/]/).pop() ?? "Folderbase Backup.zip";
  const folder = job.path?.split(/[\\/]/).slice(-2, -1)[0];
  const title =
    job.state === "running"
      ? job.beforeRestore
        ? "Backing up before restoring…"
        : "Backing up the database…"
      : job.state === "done"
        ? name
        : job.beforeRestore
          ? "Couldn’t restore the backup"
          : "Couldn’t back up the database";
  return (
    <div role="status" aria-live="polite" onMouseEnter={() => job.state === "done" && backupJobs.keep(job.id)} className={NOTICE_CLASS}>
      {job.state !== "running" && (
        <button
          type="button"
          aria-label="Close"
          onClick={() => backupJobs.dismiss(job.id)}
          className="absolute -left-1.5 -top-1.5 w-5 h-5 flex items-center justify-center rounded-full border border-neutral-700/60 bg-neutral-800 shadow text-neutral-400 hover:text-neutral-100 opacity-0 group-hover:opacity-100"
        >
          <SymbolIcon name="xmark" size={8} fallback={<span className="text-[9px] leading-none">✕</span>} />
        </button>
      )}
      <FileIcon path={name} mimeType="application/zip" size={32} />
      <div className="flex-1 min-w-0">
        <div className={`truncate font-semibold ${job.state === "failed" ? "text-red-400" : "text-neutral-100"}`}>{title}</div>
        {job.state === "running" && <ProgressBar fraction={null} className="mt-1.5 h-1" />}
        {job.state === "done" && folder && <div className="truncate text-neutral-400">Backed up to “{folder}”</div>}
        {job.state === "failed" && <div className="text-neutral-400 break-words">{job.error}</div>}
      </div>
      {job.state === "done" && job.path && <PushButton onClick={() => backupJobs.reveal(job.path!)}>{labels.reveal}</PushButton>}
    </div>
  );
}
