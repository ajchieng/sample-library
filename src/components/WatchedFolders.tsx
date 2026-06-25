import { useEffect, useRef } from "react";
import { FolderPlus, RefreshCw, Trash2, X } from "lucide-react";
import type { WatchedFolder } from "../db/folders";

type Props = {
  folders: WatchedFolder[];
  scanning: boolean;
  onAddFolder: () => void;
  onRescanAll: () => void;
  onRemove: (id: number) => void;
  onClose: () => void;
};

/** Renders a SQLite UTC timestamp as a friendly local string. */
function formatScannedAt(value: string | null): string {
  if (!value) return "Never scanned";
  const parsed = new Date(value.replace(" ", "T") + "Z");
  if (Number.isNaN(parsed.getTime())) return "Never scanned";
  return `Last scanned ${parsed.toLocaleString()}`;
}

export function WatchedFolders({
  folders,
  scanning,
  onAddFolder,
  onRescanAll,
  onRemove,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  return (
    <div className="help-backdrop" role="presentation" onClick={onClose}>
      {/* The dialog needs onKeyDown to trap Tab focus and onClick to stop a
          backdrop-closing click; these are standard modal-dialog interactions. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <section
        ref={panelRef}
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="watched-folders-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onClose();
            return;
          }
          if (e.key !== "Tab") return;
          const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          );
          if (!focusable?.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="help-panel-head">
          <div>
            <h2 id="watched-folders-title">Watched Folders</h2>
            <p>
              New audio in these folders is copied into your library when you
              rescan or relaunch. Your originals stay where they are.
            </p>
          </div>
          <button
            type="button"
            ref={closeRef}
            className="icon-btn"
            onClick={onClose}
            aria-label="Close watched folders"
          >
            <X size={17} />
          </button>
        </header>

        {folders.length === 0 ? (
          <p className="help-note">
            No folders yet. Add one to scan it for samples and keep pulling in
            new files over time.
          </p>
        ) : (
          <ul className="folder-list">
            {folders.map((folder) => (
              <li className="folder-row" key={folder.id}>
                <div className="folder-info">
                  <span className="folder-path" title={folder.path}>
                    {folder.path}
                  </span>
                  <span className="folder-meta">
                    {formatScannedAt(folder.last_scanned_at)}
                  </span>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => onRemove(folder.id)}
                  disabled={scanning}
                  aria-label={`Stop watching ${folder.path}`}
                  title="Stop watching this folder (keeps imported samples)"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="folder-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onAddFolder}
            disabled={scanning}
          >
            <FolderPlus size={16} />
            Add folder
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRescanAll}
            disabled={scanning || folders.length === 0}
          >
            <RefreshCw size={16} />
            {scanning ? "Scanning…" : "Rescan all"}
          </button>
        </div>
      </section>
    </div>
  );
}
