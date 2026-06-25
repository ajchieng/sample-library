import { useEffect, useRef } from "react";
import { Check, Tags, X } from "lucide-react";
import type { AutoTagPlan } from "../lib/autoTags";

type Props = {
  plan: AutoTagPlan;
  applying: boolean;
  onApply: () => void;
  onClose: () => void;
};

function plural(value: number, singular: string, pluralName = `${singular}s`) {
  return value === 1 ? singular : pluralName;
}

export function AutoTagPreviewDialog({
  plan,
  applying,
  onApply,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previewItems = plan.items.slice(0, 8);
  const hiddenCount = Math.max(0, plan.items.length - previewItems.length);

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
        className="help-panel auto-tag-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-tag-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          );
          if (!focusable?.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="help-panel-head">
          <div>
            <h2 id="auto-tag-title">Auto-tag existing library</h2>
            <p>
              Preview filename-derived tags before applying them. Existing tags
              are preserved.
            </p>
          </div>
          <button
            type="button"
            ref={closeRef}
            className="icon-btn"
            onClick={onClose}
            aria-label="Close auto-tag preview"
          >
            <X size={17} />
          </button>
        </header>

        {plan.sampleCount > 0 ? (
          <>
            <div className="auto-tag-summary" aria-live="polite">
              <div className="auto-tag-summary-item">
                <strong>{plan.sampleCount.toLocaleString()}</strong>
                <span>{plural(plan.sampleCount, "sample")} updated</span>
              </div>
              <div className="auto-tag-summary-item">
                <strong>{plan.tagAddCount.toLocaleString()}</strong>
                <span>{plural(plan.tagAddCount, "tag")} added</span>
              </div>
            </div>

            <div className="auto-tag-counts">
              {Object.entries(plan.tagCounts).map(([tag, count]) => (
                <span key={tag} className="chip chip-sm">
                  {tag}: {count.toLocaleString()}
                </span>
              ))}
            </div>

            <ul className="auto-tag-preview-list">
              {previewItems.map((item) => (
                <li key={item.sampleId} className="auto-tag-preview-row">
                  <div className="auto-tag-preview-main">
                    <span className="auto-tag-preview-name">{item.name}</span>
                    <span className="auto-tag-preview-file">
                      {item.filename}
                    </span>
                  </div>
                  <div className="auto-tag-preview-tags">
                    {item.tagsToAdd.map((tag) => (
                      <span key={tag} className="chip chip-sm chip-active">
                        +{tag}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>

            {hiddenCount > 0 ? (
              <p className="auto-tag-more">
                {hiddenCount.toLocaleString()} more{" "}
                {plural(hiddenCount, "sample")} will be updated.
              </p>
            ) : null}
          </>
        ) : (
          <div className="auto-tag-empty">
            <Tags size={18} />
            <div>
              <strong>No missing auto-tags found</strong>
              <p>
                The library already has the filename-derived beat and drum tags
                that match the current rules.
              </p>
            </div>
          </div>
        )}

        <div className="auto-tag-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={applying}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onApply}
            disabled={applying || plan.sampleCount === 0}
          >
            <Check size={15} />
            {applying ? "Applying..." : "Apply tags"}
          </button>
        </div>
      </section>
    </div>
  );
}
