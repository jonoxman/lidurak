<!-- WAVE:1 -->
# Ticket T-90-feedback-20261123_130625-3: Close Profile Menu Dropdown on Any Outside Click

## Summary
Currently, when the user opens the profile menu dropdown in `HeaderBar.tsx`, clicking elsewhere on the page does not close it. Implement reliable click-outside dismissal so clicking anywhere on the page outside the profile menu itself immediately closes the profile menu dropdown.

## Scope & Target Files
- `frontend/src/components/HeaderBar.tsx`
- `frontend/src/__tests__/HeaderBar.test.tsx`
- `frontend/src/__tests__/app.test.tsx` (if adding an integration test across Lobby/Game views)
- (Do NOT touch `README.md`, `ARCHITECTURE.md`, `handLayout.ts`, `GameTable.tsx`, or `table.css` owned by other tickets.)

## Implementation Requirements & End-to-End Wiring
1. **Outside-Click Dismissal in `frontend/src/components/HeaderBar.tsx`:**
   - Locate the profile menu state, trigger button, and dropdown panel inside `frontend/src/components/HeaderBar.tsx`.
   - Attach a `useRef<HTMLDivElement | null>` (or appropriate element ref) to the profile menu container that wraps **both** the profile menu trigger button and the profile menu dropdown panel (so clicking the dropdown content or the trigger itself is recognized as inside the profile menu, while clicking anything else in the header or anywhere on the page is outside).
   - When the profile menu dropdown is open, attach a document-level `pointerdown` / `mousedown` event listener with `{ capture: true }` (using capture phase ensures that even clicking interactive elements on `GamePage` / `GameTable` / `LobbyPage` that call `event.stopPropagation()` still closes the profile menu dropdown).
   - Inside the handler, check `if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node))` and close the profile menu dropdown.
   - Clean up the document listener in the `useEffect` cleanup function whenever the dropdown closes or `HeaderBar` unmounts.
   - Verify no double-toggle conflict occurs when clicking the profile menu toggle button itself (clicking it while open closes it once; clicking it while closed opens it once).
   - Verify clicking inside the profile menu dropdown itself (e.g., text inputs, buttons that don't explicitly close it, labels, or empty padding inside the dropdown panel) keeps the dropdown open.
   - Also ensure that if the Theme menu or another header menu is opened by clicking its button (which is outside the profile menu container), the profile menu dropdown closes cleanly.
2. **QA Testability (< 15 Seconds):**
   - Directly observable immediately upon opening `http://localhost:5173` on both `LobbyPage` and `GamePage` (e.g., after clicking any QA Scenario Preset): open the profile menu in the header bar, click anywhere outside it (header background, another menu button, lobby background, felt table, sidebar, or cards), and observe the profile dropdown close immediately.
3. **Unit & Integration Tests:**
   - Add tests in `frontend/src/__tests__/HeaderBar.test.tsx` covering:
     - Opening the profile menu dropdown renders the dropdown.
     - Clicking outside the profile menu (e.g., on `document.body`, another sibling element outside the header, or another header control such as the Theme button) closes the profile menu dropdown.
     - Clicking an outside element whose handler calls `stopPropagation()` still closes the profile menu dropdown.
     - Clicking inside the profile menu dropdown itself does NOT close the dropdown.
     - Clicking the profile menu trigger button toggles the dropdown open and closed cleanly.
     - Event listener is cleaned up on close/unmount without errors.

## Mandatory Acceptance Criteria Checklist
- [ ] **Verbatim Feedback (`ITEM-3` / `# New` #2):** "Clicking anywhere on the page that is not the profile menu itself should close the profile menu dropdown."
- [ ] Wired end-to-end in `frontend/src/components/HeaderBar.tsx` (active across both `LobbyPage.tsx` and `GamePage.tsx`).
- [ ] Clicking anywhere on the page outside the profile menu (including the lobby background, felt table arena, sidebars, other header controls, and elements that stop event propagation) closes the profile menu dropdown immediately.
- [ ] Clicking inside the profile menu dropdown itself does not unexpectedly close it, and clicking the profile trigger button toggles cleanly without double-toggling.
- [ ] Document event listener is properly cleaned up on close and unmount.
- [ ] `cd frontend && npm test -- --run` passes with zero errors.
- [ ] Summary written to `.reviews/agent_notes.md`, no git commits made, and `echo "DONE" > .tickets/STATUS` executed only after all tests pass.
