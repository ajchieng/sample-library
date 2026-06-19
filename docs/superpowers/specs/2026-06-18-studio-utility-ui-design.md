# Studio Utility UI Design

## Goal

Make Sample Tracker feel more clean, modern, and polished while preserving the existing local-first sample workflow.

## Approved Direction

Use the **Studio Utility** direction: a refined dark desktop interface with cooler charcoal surfaces, restrained teal-blue accent, stronger table scanning, and less purple/neon character.

## Scope

- Preserve the existing app structure: top bar, filter bar, sample list, detail editor, and bottom audio player.
- Keep behavior unchanged: import, search, filters, keyboard navigation, favorite toggles, missing-file detection, relink, reveal in Finder, save, delete, and playback should keep their current semantics.
- Improve visual quality through tokens, spacing, hierarchy, state styling, and component polish.
- Avoid generic SaaS dashboard patterns, decorative metric cards, marketing chrome, and flashy producer visuals.

## UI Requirements

- Refresh the color system to cooler charcoal surfaces with a restrained teal-blue primary accent.
- Improve text contrast and muted-text readability for WCAG AA-oriented product UI.
- Modernize buttons, filters, chips, rows, fields, toast, and the bottom player with consistent states.
- Make the list easier to scan with clearer selected, hover, missing, favorite, and column treatments.
- Make the editor feel calmer and more structured without changing field order or data entry behavior.
- Make the audio player feel integrated and professional, with clearer control and waveform treatment.

## Verification

- Run `npm test`.
- Run `npm run build`.
- Run the app or Vite frontend locally and visually inspect desktop and narrower widths.
- Confirm no text overlaps, controls remain usable, and the app still reads as a task-focused desktop tool.
