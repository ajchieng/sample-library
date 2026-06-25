import { FolderPlus, FolderSearch } from "lucide-react";

type Props = {
  onAddFolder: () => void;
  onOpenManager: () => void;
  folderCount: number;
  scanning: boolean;
};

export function FolderControls({
  onAddFolder,
  onOpenManager,
  folderCount,
  scanning,
}: Props) {
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={onAddFolder}
        disabled={scanning}
        title="Pick a folder; new audio files are copied into your library"
      >
        <FolderPlus size={16} />
        {scanning ? "Scanning…" : "Add folder"}
      </button>
      {folderCount > 0 ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onOpenManager}
          title="Manage and rescan watched folders"
        >
          <FolderSearch size={16} />
          Folders ({folderCount})
        </button>
      ) : null}
    </>
  );
}
