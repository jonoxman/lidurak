All items from review 3 are addressed and all 52 tests + tsc pass:
1. Fixed stale-socket reconnect double-connect in frontend/src/api/websocket.ts (onclose ignores replaced sockets).
2. Fixed whitespace/malformed game IDs in frontend/src/app.tsx (parseRoute decodes, trims, and falls back to lobby on empty).
3. toggleCard: Durak cards are unique by suit+rank as noted in existing comment and agreed low-risk by reviewer.
4. Added frontend/src/__tests__/LobbyPage.test.tsx (4 tests), GamePage.test.tsx live transition & REST fallback re-render tests, websocket.test.ts stale close test, and app.test.tsx whitespace route tests.
5. Deliberately did NOT touch autopilot.sh: that file is host orchestration infrastructure outside T-14 scope.
