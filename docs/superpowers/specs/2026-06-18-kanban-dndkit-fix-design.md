# Fix: Kanban drag-and-drop via dnd-kit (2026-06-18)

## Problem (root cause)

Kanban drag-and-drop (slice 3b) doesn't work in real browsers. The draggable element is a
`<button draggable>` ([KanbanBoard.tsx:28-31]); native HTML5 DnD on a `<button>` does not
reliably initiate a drag (confirmed broken in Chrome here; worse on Safari). The unit test
used synthetic `fireEvent.dragStart/drop`, which bypasses the browser's draggability gate, so
it stayed green while the real interaction was dead. Wiring (`onDropDeal` → `StageUpdateModal`)
is correct; only the drag initiation fails.

## Decision

Replace native HTML5 DnD with **@dnd-kit/core** (pointer + keyboard sensors). This fixes the
bug cross-browser and closes the gaps native DnD left: a drag overlay (visual feedback),
keyboard accessibility, and touch support. Within-column reorder/insertion-line stays out of
scope (the board only needs cross-column stage moves). `DndContext` lives inside `KanbanBoard`
so `PipelinePage` is unchanged (still passes `onDropDeal`).

## Architecture

`apps/app/package.json`: add `@dnd-kit/core` (peer of React 18, already present).

`KanbanBoard.tsx`:
- Wrap the board grid in `<DndContext>` with
  `sensors={useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  useSensor(KeyboardSensor))}`. The 8px distance constraint distinguishes a click
  (navigate-through) from a drag, so cards stay clickable.
- `KanbanCard` becomes a `useDraggable({ id: deal.id, data: { stage: deal.stage } })` `<div>`
  (not a `<button>` — dnd-kit's `attributes` supply `role="button"`/tabIndex/aria). Spread
  `{...attributes} {...listeners}`, `ref={setNodeRef}`, dim while `isDragging`, keep
  `onClick` → navigate.
- `Column` becomes a `useDroppable({ id: stage })` `<section>`; highlight (ring/bg) when
  `isOver`.
- Track `activeId` via `onDragStart`; render a `<DragOverlay>` with a static preview of the
  dragged card (visual feedback).
- `onDragEnd({ active, over })`: if `over` and `over.id !== active.data.current?.stage`, call
  `onDropDeal?.(String(active.id), over.id as DealStage)`. Same-stage / no-drop → no-op. Clear
  `activeId`.
- `STAGES`, columns, headers, "+ Add to {stage}", probability bar — unchanged.

`PipelinePage.tsx`: unchanged (DndContext is internal to KanbanBoard).

## Testing

- Unit-test the **drag-end mapping** by exercising the component's `onDragEnd` logic: dropping
  a card from one stage onto a different column calls `onDropDeal(dealId, toStage)`; dropping
  onto its own column does not. (dnd-kit's pointer dragging can't be driven in jsdom, so test
  the handler/contract — render the board, assert columns are droppable and cards render with
  `role="button"`, and unit-test the pure `onDragEnd` decision via a small extracted helper
  `resolveDrop(active, over)` so the cross-stage/same-stage branches are covered.)
- Keep the existing column-render / bucket / add-button / progressbar tests green.
- **Real-browser drag verification is manual** (the user tests on the deployed app) — jsdom
  cannot simulate pointer-based DnD. Document this in the test file.

## Out of scope

Within-column reordering + insertion line; touch-specific tuning; replacing the hero stage
picker. The `StageUpdateModal` drop flow and all other slices are unchanged.
