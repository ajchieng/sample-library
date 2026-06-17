import { Plus } from "lucide-react";

type Props = {
  onClick: () => void;
  importing: boolean;
};

export function AddSampleButton({ onClick, importing }: Props) {
  return (
    <button
      className="btn btn-primary import-btn"
      onClick={onClick}
      disabled={importing}
    >
      <Plus size={16} />
      {importing ? "Importing…" : "Import"}
    </button>
  );
}
