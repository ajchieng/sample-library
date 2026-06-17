import { useState } from "react";
import { X } from "lucide-react";

type Props = {
  /** Currently selected tags for the sample. */
  selected: string[];
  /** All known tag names (for the quick-add palette). */
  allTags: string[];
  onChange: (tags: string[]) => void;
};

export function TagEditor({ selected, allTags, onChange }: Props) {
  const [draft, setDraft] = useState("");

  const addTag = (raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (!tag || selected.includes(tag)) return;
    onChange([...selected, tag]);
  };

  const removeTag = (tag: string) => {
    onChange(selected.filter((t) => t !== tag));
  };

  const available = allTags.filter((t) => !selected.includes(t));

  return (
    <div className="tag-editor">
      <div className="tag-selected">
        {selected.map((tag) => (
          <span key={tag} className="chip chip-active">
            {tag}
            <button
              className="chip-x"
              onClick={() => removeTag(tag)}
              aria-label={`Remove tag ${tag}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}

        <input
          className="tag-input"
          value={draft}
          placeholder="Add tag…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag(draft);
              setDraft("");
            } else if (e.key === "Backspace" && draft === "" && selected.length) {
              removeTag(selected[selected.length - 1]);
            }
          }}
        />
      </div>

      {available.length > 0 ? (
        <div className="tag-palette">
          {available.map((tag) => (
            <button
              key={tag}
              className="chip chip-add"
              onClick={() => addTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
