import { useEffect, useState } from "react";
import { AlertTriangle, FolderOpen, Link2, Trash2 } from "lucide-react";
import type { Sample, SampleMetadata, SampleType } from "../types/sample";
import { SAMPLE_TYPES } from "../types/sample";
import { TagEditor } from "./TagEditor";

type Props = {
  sample: Sample;
  allTags: string[];
  saving: boolean;
  missing: boolean;
  onSave: (id: number, meta: SampleMetadata, tags: string[]) => void;
  onDelete: (id: number) => void;
  onReveal: (filePath: string) => void;
  onRelink: (id: number) => void;
  onClose: () => void;
};

type Draft = {
  name: string;
  type: string;
  bpm: string;
  musical_key: string;
  mood: string;
  source: string;
  notes: string;
  tags: string[];
};

function draftFromSample(s: Sample): Draft {
  return {
    name: s.name,
    type: s.type ?? "",
    bpm: s.bpm != null ? String(s.bpm) : "",
    musical_key: s.musical_key ?? "",
    mood: s.mood ?? "",
    source: s.source ?? "",
    notes: s.notes ?? "",
    tags: s.tags,
  };
}

export function SampleEditor({
  sample,
  allTags,
  saving,
  missing,
  onSave,
  onDelete,
  onReveal,
  onRelink,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftFromSample(sample));
  const [bpmError, setBpmError] = useState<string | null>(null);

  // Reset the form whenever a different sample is selected.
  useEffect(() => {
    setDraft(draftFromSample(sample));
    setBpmError(null);
  }, [sample.id]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const validateBpm = (): number | null | false => {
    const raw = draft.bpm.trim();
    if (raw === "") return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 1000) {
      setBpmError("BPM must be a whole number between 0 and 1000.");
      return false;
    }
    return n;
  };

  const handleSave = () => {
    const bpm = validateBpm();
    if (bpm === false) return;
    const name = draft.name.trim();
    if (!name) return;

    setBpmError(null);
    const meta: SampleMetadata = {
      name,
      bpm,
      musical_key: draft.musical_key.trim() || null,
      type: (draft.type as SampleType) || null,
      mood: draft.mood.trim() || null,
      source: draft.source.trim() || null,
      notes: draft.notes.trim() || null,
    };
    onSave(sample.id, meta, draft.tags);
  };

  const handleDelete = () => {
    const ok = window.confirm(
      "Remove this sample from the library? The original audio file will not be deleted.",
    );
    if (ok) onDelete(sample.id);
  };

  return (
    <div className="editor">
      <div className="editor-head">
        <div className="editor-title-block">
          <input
            className="editor-title"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            aria-label="Sample name"
          />
          <div className="editor-filename" title={sample.file_path}>
            {sample.original_filename ?? sample.file_path}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </div>

      <div className="editor-body">
        {missing ? (
          <div className="missing-banner">
            <AlertTriangle size={16} className="missing-banner-icon" />
            <div className="missing-banner-text">
              <strong>This file could not be found.</strong> It may have been
              moved or deleted. Relink it to its new location.
              <button
                className="btn btn-secondary btn-sm relink-btn"
                onClick={() => onRelink(sample.id)}
              >
                <Link2 size={14} />
                Relink…
              </button>
            </div>
          </div>
        ) : null}

        <Field label="Type">
          <select
            value={draft.type}
            onChange={(e) => set("type", e.target.value)}
          >
            <option value="">—</option>
            {SAMPLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <div className="field-row">
          <Field label="BPM">
            <input
              type="number"
              min={0}
              value={draft.bpm}
              placeholder="—"
              onChange={(e) => set("bpm", e.target.value)}
            />
          </Field>
          <Field label="Key">
            <input
              value={draft.musical_key}
              placeholder="—"
              onChange={(e) => set("musical_key", e.target.value)}
            />
          </Field>
        </div>
        {bpmError ? <p className="field-error">{bpmError}</p> : null}

        <Field label="Mood">
          <input
            value={draft.mood}
            placeholder="e.g. warm, dark, bright"
            onChange={(e) => set("mood", e.target.value)}
          />
        </Field>

        <Field label="Source">
          <input
            value={draft.source}
            placeholder="Pack or folder"
            onChange={(e) => set("source", e.target.value)}
          />
        </Field>

        <Field label="Tags">
          <TagEditor
            selected={draft.tags}
            allTags={allTags}
            onChange={(tags) => set("tags", tags)}
          />
        </Field>

        <Field label="Notes">
          <textarea
            value={draft.notes}
            rows={3}
            placeholder="Anything worth remembering…"
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </div>

      <div className="editor-actions">
        <button
          className="btn btn-primary btn-block"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <div className="editor-actions-row">
          <button
            className="btn btn-secondary"
            onClick={() => onReveal(sample.file_path)}
          >
            <FolderOpen size={15} />
            Finder
          </button>
          <button
            className="btn btn-danger icon-only"
            onClick={handleDelete}
            aria-label="Remove from library"
            title="Remove from library"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
