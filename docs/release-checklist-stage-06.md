# Stage 06 release checklist

Automated verification recorded on 2026-09-01:

- `npm test`: persistence, validation, autosave, LRU/LOD and culling unit coverage.
- `npm run test:e2e`: Chromium, mobile WebKit and Firefox projects; JSON round-trip, atomic rejection, autosave restore/decline, nested transport, cats/clothing, sheets/notebooks, touch/pen input and 44 px targets.
- `npm run build`: production bundle succeeds.
- `npm run test:production`: standalone production preview starts and has no development debug panel.

Input coverage:

- Mouse and keyboard: Chromium and Firefox.
- Touch, two-pointer pinch and pen pressure events: mobile WebKit emulation.
- A final physical-device touch/stylus check remains a release operator check because no physical digitizer is exposed to the automated workspace.

Regression verification recorded on 2026-09-02 after the nested-sheet drop fix:

- `npm test`: 78 tests passed across 13 files.
- `npx playwright test --project=desktop-chromium`: 21 passed, 2 mobile-only scenarios skipped.
- The previously failing `nests one sheet in another and moves the hidden tree` scenario passes.
- `npm run build`: production bundle succeeds; the existing 500 kB chunk-size warning remains.
- `npm run test:production`: standalone production preview passes after the drawing `RenderTexture` cache change.
- Full `npm run test:e2e`: 56 passed across desktop Chromium, desktop Firefox and mobile WebKit; 13 intentionally project-specific scenarios skipped.
