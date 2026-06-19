import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle,
  Check,
  Copy,
  FolderOpen,
  Link2,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { Sample, SampleMetadata, SampleType } from "../types/sample";
import { SAMPLE_TYPES } from "../types/sample";
import { formatConfidence } from "../lib/analysis";
import {
  audioSummary,
  draftFromSample,
  draftsEqual,
  validateBpmInput,
  type SampleDraft,
} from "../lib/sampleView";
import { TagEditor } from "./TagEditor";

type Props = {
  sample: Sample;
  allTags: string[];
  saving: boolean;
  missing: boolean;
  exactDuplicateCount: number;
  nearDuplicateCount: number;
  onSave: (id: number, meta: SampleMetadata, tags: string[]) => void;
  onDelete: (id: number) => void;
  onReveal: (filePath: string) => void;
  onCopy: (filePath: string) => void;
  onRelink: (id: number) => void;
  onToggleFavorite: (id: number, value: boolean) => void;
  onClose: () => void;
  /** Reports whether the form has unsaved edits, so the app can guard against
   * navigating away and silently discarding them. */
  onDirtyChange: (dirty: boolean) => void;
};

export function SampleEditor({
  sample,
  allTags,
  saving,
  missing,
  exactDuplicateCount,
  nearDuplicateCount,
  onSave,
  onDelete,
  onReveal,
  onCopy,
  onRelink,
  onToggleFavorite,
  onClose,
  onDirtyChange,
}: Props) {
  const [draft, setDraft] = useState<SampleDraft>(() =>
    draftFromSample(sample),
  );
  const [bpmError, setBpmError] = useState<string | null>(null);

  // Reset the form whenever a different sample is selected.
  useEffect(() => {
    setDraft(draftFromSample(sample));
    setBpmError(null);
    // Reset only when a DIFFERENT sample is selected (id change); re-running on
    // every `sample` change would clobber in-progress edits after a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample.id]);

  // Track unsaved edits by comparing the draft against the saved sample. After
  // a successful save, `sample` updates to match the draft and this flips back
  // to false on its own.
  const pristine = useMemo(() => draftFromSample(sample), [sample]);
  const isDirty = useMemo(
    () => !draftsEqual(draft, pristine),
    [draft, pristine],
  );

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // Clear the flag when the editor unmounts (sample deselected or deleted).
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const set = <K extends keyof SampleDraft>(key: K, value: SampleDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const handleSave = () => {
    const bpm = validateBpmInput(draft.bpm);
    if (!bpm.ok) {
      setBpmError(bpm.error);
      return;
    }
    const name = draft.name.trim();
    if (!name) return;

    setBpmError(null);
    const meta: SampleMetadata = {
      name,
      bpm: bpm.value,
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

  const hasDetectedBpm = sample.detected_bpm != null;
  const hasDetectedKey = Boolean(sample.detected_key);
  const roundedDetectedBpm = hasDetectedBpm
    ? String(Math.round(sample.detected_bpm ?? 0))
    : "";

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
          {audioSummary(sample) ? (
            <div className="editor-audio-meta">{audioSummary(sample)}</div>
          ) : null}
        </div>
        <button
          type="button"
          className={clsx("icon-btn star-btn", { active: sample.is_favorite })}
          aria-pressed={sample.is_favorite}
          aria-label={
            sample.is_favorite ? "Remove from favorites" : "Add to favorites"
          }
          title={
            sample.is_favorite ? "Remove from favorites" : "Add to favorites"
          }
          onClick={() => onToggleFavorite(sample.id, !sample.is_favorite)}
        >
          <Star size={17} fill={sample.is_favorite ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label="Close panel"
        >
          <X size={17} />
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
                type="button"
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

        {hasDetectedBpm ||
        hasDetectedKey ||
        sample.analysis_status === "error" ? (
          <div className="analysis-panel">
            <div className="analysis-panel-title">
              <Sparkles size={15} />
              Analysis
            </div>
            {hasDetectedBpm ? (
              <div className="analysis-suggestion">
                <span>
                  BPM {roundedDetectedBpm}
                  <small>
                    {formatConfidence(sample.detected_bpm_confidence)}{" "}
                    confidence
                  </small>
                </span>
                <button
                  type="button"
                  className="mini-action"
                  onClick={() => set("bpm", roundedDetectedBpm)}
                >
                  <Check size={13} />
                  Apply
                </button>
              </div>
            ) : null}
            {hasDetectedKey ? (
              <div className="analysis-suggestion">
                <span>
                  Key {sample.detected_key}
                  <small>
                    {formatConfidence(sample.detected_key_confidence)}{" "}
                    confidence
                  </small>
                </span>
                <button
                  type="button"
                  className="mini-action"
                  onClick={() => set("musical_key", sample.detected_key ?? "")}
                >
                  <Check size={13} />
                  Apply
                </button>
              </div>
            ) : null}
            {sample.analysis_status === "error" ? (
              <p className="analysis-error">
                Analysis unavailable
                {sample.analysis_error ? `: ${sample.analysis_error}` : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        {exactDuplicateCount > 1 || nearDuplicateCount > 1 ? (
          <div className="duplicate-panel">
            {exactDuplicateCount > 1 ? (
              <div className="duplicate-alert">
                <Copy size={15} />
                <span>
                  Exact duplicate in {exactDuplicateCount} library entries
                </span>
              </div>
            ) : null}
            {nearDuplicateCount > 1 ? (
              <div className="duplicate-alert muted">
                <Copy size={15} />
                <span>
                  Likely similar audio in {nearDuplicateCount} library entries
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

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
          type="button"
          className="btn btn-primary btn-block"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <div className="editor-actions-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onReveal(sample.file_path)}
          >
            <FolderOpen size={15} />
            Finder
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onCopy(sample.file_path)}
            disabled={missing}
            title={
              missing
                ? "Relink this missing file before copying it"
                : "Copy the file to the clipboard (⌘C) — paste it into Finder or a DAW"
            }
          >
            <Copy size={15} />
            Copy
          </button>
          <button
            type="button"
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
