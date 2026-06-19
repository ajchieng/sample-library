import { useEffect, useRef } from "react";
import { X } from "lucide-react";

type Props = {
  onClose: () => void;
};

const shortcuts = [
  ["Import samples", "Click Import"],
  ["Search", "Use the search field"],
  ["Toggle files in selection", "Cmd/Ctrl-click"],
  ["Select a range", "Shift-click"],
  ["Select all visible files", "Cmd/Ctrl-A"],
  ["Drag sample to Finder / DAW", "Drag any sample row"],
  ["Select next / previous", "Arrow Down / Arrow Up"],
  ["Jump to first / last", "Home / End"],
  ["Play / pause selected sample", "Space"],
  ["Favorite selected sample", "Star button"],
  ["Save edits", "Save Changes"],
  ["Reveal file", "Finder"],
  ["Show this help", "?"],
];

export function KeyboardHelp({ onClose }: Props) {
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
        aria-labelledby="keyboard-help-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
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
            <h2 id="keyboard-help-title">Keyboard Help</h2>
            <p>Shortcuts and core actions for working through a sample list.</p>
          </div>
          <button
            type="button"
            ref={closeRef}
            className="icon-btn"
            onClick={onClose}
            aria-label="Close help"
          >
            <X size={17} />
          </button>
        </header>

        <div className="shortcut-list">
          {shortcuts.map(([label, keys]) => (
            <div className="shortcut-row" key={label}>
              <span>{label}</span>
              <kbd>{keys}</kbd>
            </div>
          ))}
        </div>

        <p className="help-note">
          Your original files are never moved, renamed, or uploaded — Sample
          Tracker imports its own copies into a managed library.
        </p>
      </section>
    </div>
  );
}
