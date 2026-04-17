# Plan #11 — Fix Submodule Reordering & Range Validation

> Task #11 · Status: MERGED

## What & Why
On the exam detail page, users cannot reorder the composed-exam submodule rows (and the subcategory rows above them have the same problem): grabbing the ⋮⋮ handle or the range field does nothing, so the order is effectively frozen. On top of that, the readiness check complains "Range is required for submodule X" even after the user has typed a valid range, because it reads from the saved tag data instead of what's in the form.

Both issues live in `public/exam.html` on the same feature area (composed submodules + subcategories), so they are bundled into one task to avoid stepping on the same rendering code twice.

## Done looks like
- On the exam page, clicking and dragging the ⋮⋮ handle on any submodule row reliably starts a drag; dropping on another row reorders them. Same behavior for subcategory rows.
- Clicking or selecting text inside the Range input does NOT accidentally start a drag, and conversely does not silently block it — the handle is the single, obvious grab point.
- After typing a valid range in every submodule row, the "missing requirements" list no longer shows "Composed submodule ranges" as outstanding. The readiness indicator updates as soon as the user types, not only after pressing Save.
- Save-time validation (separate path) continues to work exactly as today and still blocks saves with invalid/missing ranges.
- Keyboard accessibility: the ⋮⋮ handle remains focusable; drag stays mouse-driven (no regression vs today).

## Out of scope
- Replacing the custom drag-and-drop with a library (Sortable.js etc.) — keep native HTML5 DnD.
- Any visual redesign of the submodule/subcategory rows.
- Changes to how ranges are parsed or to the tag storage format.
- Touch / mobile drag support.

## Tasks
1. **Move `draggable` onto the handle** — Attach `draggable="true"` and the `ondragstart`/`ondragend` handlers to the ⋮⋮ handle element itself, for both composed submodule rows and subcategory rows. Keep `ondragover` / `ondragleave` / `ondrop` on the row container so the drop zones still cover the whole row. The handle should become the only element that initiates a drag; inputs and name fields should no longer compete with it.
2. **Use live state for the readiness check** — Update the prompt-readiness path so that when the composed submodule section is rendered on screen, validation reads from the in-memory submodule state rather than the stored tag value. When the section is not rendered (e.g., before the row loads), fall back to the stored value as today. Keep the save-time validation path unchanged.
3. **Manual verification** — Load an exam with composed submodules, confirm drag reorders via the handle, confirm text selection in the range input works without hijacking drag, and confirm the readiness indicator clears live as ranges are typed.

## Relevant files
- `public/exam.html`
