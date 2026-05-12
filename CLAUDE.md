# Project: navigatr

## Design system source of truth

`/Users/ryanmeo/Downloads/DESIGN.md` is the design system reference for this project. Read it before any Figma work. Do not work from memory.

The active Figma file is **navigatr v1** (`fileKey: ti9rBqqWjTro9jIwLaCmVN`). Use the Figma Remote MCP namespace (`mcp__c564a1a7-db32-496f-ba98-4f0c23a1678f__use_figma`), not local Dev Mode.

## Figma MCP — how to get data back from `use_figma`

The `use_figma` tool's plugin runtime discards `return` and `console.log`. To surface data, end the JS payload with `throw new Error("OUT::" + JSON.stringify(result))` and parse the rejected error message: take everything after `OUT::` up to the first `\n    at ` (Figma's stack-trace prefix), then `JSON.parse`. If the message has no `OUT::` marker it's a real error — surface it.

**Single source of truth: `tools/figma-mcp-helper.ts`.** Read it before any Figma-fidelity session. It carries the canonical marker, the wrap template, and a parser. Don't reinvent the pattern inline; if `use_figma` ever starts surfacing return values, retire the helper in one place.

## Mandatory: post-build audit before declaring Figma work done

**Before reporting any Figma build pass as complete**, run the canonical post-build audit from DESIGN.md (the runnable JS block under "Canonical post-build audit"). It checks six bug classes file-wide:

1. Page-level overlaps
2. Alpha-baked paint.opacity ≠ variable.alpha
3. KPI row child height mismatches
4. Pill avatars (w ≠ h)
5. 1px-collapsed wrap-grid items
6. Generic content overflow

Expected output:
```json
{"pageOverlaps":0,"alphaMismatches":0,"kpiHeightMismatches":0,"pillAvatars":0,"collapsedFrames":0,"overflows":0}
```

Anything non-zero: stop, fix, re-run. Do not report DONE until all six are zero. Do not report DONE_WITH_CONCERNS as a substitute for fixing — every recurring bug class in this project's history was a result of stopping at "concerns" instead of running the audit.

## Recurring bug classes (read DESIGN.md anti-patterns 1, 11, 15-22 before each session)

These keep coming back in fresh code if not actively guarded against:
- Alpha-baked tints rendering solid (Figma drops `color.a` from bound paints — must set `paint.opacity = variable.alpha`)
- Sidebar active fill stamped at wrong opacity on fresh instances
- Vector paths positioned at (0,0) when SVG data uses absolute coords
- HUG cards in a row producing uneven heights when content varies
- WRAP grids silently collapsing to fewer columns when `tileW × cols + gap` exceeds parent width
- Hardcoded Y positions on master frames drifting when other frames grow

The fix patterns for each are in DESIGN.md. The audit catches the symptoms.
