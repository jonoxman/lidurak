# T-14: Frontend WebSocket Client & Interactive Game Play

## Objective
Implement the WebSocket connection manager, game state management, card interaction UX, and a working local play flow where the user can create a game via the REST API and play it interactively at `http://localhost:5173`.

## Requirements

### File: `frontend/src/api/client.ts`

REST API client:
```typescript
export async function createGame(playerCount: number, playerNames: string[], allowRedirect?: boolean): Promise<{ gameId: string, players: string[] }>
export async function getGameView(gameId: string, playerId: string): Promise<PlayerGameView>
export async function sendAction(gameId: string, action: GameAction): Promise<PlayerGameView | { error: string }>
```

### File: `frontend/src/api/websocket.ts`

WebSocket connection manager:
```typescript
export class GameWebSocket {
  constructor(gameId: string, playerId: string, onStateUpdate: (view: PlayerGameView) => void)
  connect(): void
  sendAction(action: GameAction): void
  disconnect(): void
}
```
- Connects to `ws://${location.host}/ws/game/${gameId}/${playerId}`
- Parses incoming `PlayerGameView` JSON and calls `onStateUpdate`
- Sends `GameAction` JSON objects
- Auto-reconnect on disconnect (with exponential backoff, max 3 retries)

### File: `frontend/src/types.ts`

TypeScript interfaces matching the backend JSON codecs:
```typescript
export interface Card { suit: string; rank: string }
export interface TablePair { attack: Card; defense?: Card }
export interface PublicPlayerSummary { id: string; name: string; cardCount: number; hasPassed: boolean; finishRank?: number }
export interface PlayerGameView {
  myId: string; myHand: Card[]; opponents: PublicPlayerSummary[];
  tablePairs: TablePair[]; talonCount: number; bottomTrumpCard?: Card;
  trumpSuit: string; attackerIdx: number; defenderIdx: number;
  boutPhase: string; legalActions: string[]; finishOrder: string[];
  isDraw: boolean; maxBoutAttacks: number;
}
export interface GameAction { type: string; playerId: string; [key: string]: any }
```

### File: `frontend/src/pages/GamePage.tsx`

The main game page component (`/g/:gameId` route or default local page):
- **State:** `PlayerGameView | null`, selected cards `Set<number>`, current player ID
- **Card Selection UX:**
  - Clicking a card in hand toggles selection (Card component's `selected` prop)
  - For attacks: select multiple same-rank cards, click "Attack" button
  - For defense: select one hand card, then click an uncovered table card to cover it
  - For throw-in: select matching-rank cards, click "Throw In" button
- **Action Dispatch:** Clicking action buttons builds the appropriate `GameAction` JSON and sends it via WebSocket (or REST fallback)
- **Game Over Display:** When `boutPhase === "GameOver"`, show results (winner, Durak, draw)

### File: `frontend/src/pages/LobbyPage.tsx`

Simple local lobby for M1 (not the full matchmaking lobby):
- Form to create a local game: player count (2/3/4), player names, redirect toggle
- "Create Game" button → calls `POST /api/game/create`
- On success, displays game links/tabs for each player to open `GamePage`
- For local testing: provide a tabbed view or player-selector dropdown to switch between player views

### File: `frontend/src/app.tsx`

Update to include basic client-side routing:
- `/` → `LobbyPage`
- `/g/:gameId` → `GamePage`
- Use `preact-router` or a simple hash-based router

### Test File: `frontend/src/__tests__/types.test.ts`

- `PlayerGameView` interface validates against sample JSON from backend
- `GameAction` construction for each action type produces valid JSON structure

### Test File: `frontend/src/__tests__/websocket.test.ts`

- `GameWebSocket` calls `onStateUpdate` when receiving a valid message
- `sendAction` serializes action to JSON correctly
- (Use mock WebSocket or jsdom WebSocket stub)

## Acceptance Criteria
- [ ] Local game creation flow works: create game → see table → play moves
- [ ] WebSocket client connects and receives state updates
- [ ] Card selection and action dispatch produce correct `GameAction` payloads
- [ ] Multiple player views are accessible for local testing
- [ ] All tests pass
- [ ] Full stack is playable at `http://localhost:5173` (with backend on `:8080`)

## Verification Command
```bash
cd frontend && npm test -- --run
```
