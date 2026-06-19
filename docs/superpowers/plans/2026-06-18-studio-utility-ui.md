# Studio Utility UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh Sample Tracker into a cleaner, more modern studio utility UI without changing app behavior.

**Architecture:** Keep the current React component tree and app state intact. Use CSS tokens and targeted markup class additions to refine the visual system, interaction states, and responsive behavior.

**Tech Stack:** React 18, TypeScript, Vite, Tauri v2, CSS custom properties, lucide-react, wavesurfer.js.

---

### Task 1: Refresh Visual Tokens And Shell

**Files:**
- Modify: `src/styles.css`

- [ ] Replace root color, radius, spacing, and motion tokens with the Studio Utility palette.
- [ ] Update the app shell, topbar, content split, list pane, detail pane, and bottom player surfaces.
- [ ] Preserve the existing `height: 100vh` desktop app model and overflow behavior.

### Task 2: Polish Controls And Filters

**Files:**
- Modify: `src/styles.css`

- [ ] Normalize button, icon button, search input, select, number input, and textarea styling.
- [ ] Improve hover, active, focus-visible, disabled, selected, missing, and favorite states.
- [ ] Keep filter controls dense and wrapping safely at narrower widths.

### Task 3: Improve List, Editor, And Player Scanning

**Files:**
- Modify: `src/styles.css`
- Modify only if needed: `src/components/SampleEditor.tsx`, `src/components/SampleList.tsx`, `src/components/AudioPlayer.tsx`

- [ ] Improve table headers, rows, tags, type dots, selected-row state, missing-row state, and footer.
- [ ] Improve editor header, fields, missing banner, sticky actions, and empty states.
- [ ] Improve audio player metadata, waveform frame, loop/volume controls, and bottom-bar hierarchy.

### Task 4: Verify

**Files:**
- Inspect: rendered app in browser or Tauri dev where available.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Start a local frontend server and inspect the UI visually.
- [ ] Fix any build, type, layout, or obvious visual defects found during verification.
