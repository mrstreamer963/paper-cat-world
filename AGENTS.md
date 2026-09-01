# Project interaction invariants

## Exact placement for ordinary objects

- Never snap, clamp, nudge, center, offset, or otherwise change the drop transform of sheets, notebooks, papers, containers, cats, or any other ordinary draggable object.
- For those objects, a successful drop must preserve the exact preview/world transform produced by the drag gesture. If placement is rejected incorrectly, fix hit-testing, visible-state geometry, surface selection, or placement validation; do not "fix" it by changing the object's coordinates.
- The only objects allowed to use placement snapping are clothing (`entity.wearable`) and items explicitly marked as placeable on a cat (`entity.item`). Their cat attachment/zone behavior may intentionally reposition them.
- Folded and unfolded sheets have different visible bounds. Placement validation and hit-testing must use the geometry of the sheet's current state without mutating its requested transform.
- Add or keep regression tests that assert exact transform equality after drops of ordinary objects. A test that merely checks that the drop succeeded is insufficient.

