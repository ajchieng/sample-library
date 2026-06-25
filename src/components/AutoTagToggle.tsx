import { Tags } from "lucide-react";

type Props = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

export function AutoTagToggle({ enabled, onChange }: Props) {
  return (
    <label className="auto-tag-toggle">
      <input
        type="checkbox"
        role="switch"
        checked={enabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="auto-tag-track" aria-hidden="true">
        <span className="auto-tag-thumb" />
      </span>
      <Tags size={15} />
      <span>Auto-tag</span>
    </label>
  );
}
