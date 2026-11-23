# T-12: Game Actor & Http4s REST/WebSocket Server

## Objective
Implement a Cats Effect–based game actor that holds game state in a `Ref` and broadcasts updates via `Topic`, plus Http4s routes for creating games, querying state, and playing via WebSocket. Wire everything into `Main.scala` serving on `0.0.0.0:8080`.

## Requirements

### File: `backend/src/main/scala/durak/server/GameActor.scala`

```scala
package durak.server

import cats.effect.*
import cats.effect.std.Queue
import fs2.concurrent.Topic

case class GameRoom(
  gameId: String,
  stateRef: Ref[IO, GameState],
  topic: Topic[IO, GameState],  // Broadcasts state changes
  playerIds: Vector[String]
)

object GameActor:
  def create(config: GameConfig, playerNames: Vector[String]): IO[GameRoom]
  def applyAction(room: GameRoom, action: GameAction): IO[Either[String, GameState]]
```

- `create`: Initializes `GameState` via `GameEngine.createGame`, stores in `Ref`, creates `Topic`.
- `applyAction`: Atomically validates and applies the action via `stateRef.modify`, publishes new state to `topic`.

### File: `backend/src/main/scala/durak/server/GameManager.scala`

```scala
package durak.server

import cats.effect.*

class GameManager(rooms: Ref[IO, Map[String, GameRoom]]):
  def createGame(config: GameConfig, playerNames: Vector[String]): IO[GameRoom]
  def getRoom(gameId: String): IO[Option[GameRoom]]
```

- Generates unique `gameId` (UUID).
- Stores rooms in the `Ref[IO, Map]`.

### File: `backend/src/main/scala/durak/server/GameRoutes.scala`

```scala
package durak.server

import org.http4s.*
import org.http4s.dsl.io.*

object GameRoutes:
  def routes(manager: GameManager): HttpRoutes[IO]
```

**REST Endpoints:**
- `POST /api/game/create` — Body: `{"playerCount": 2, "playerNames": ["Alice", "Bob"], "allowRedirect": true}` → Creates game, returns `{"gameId": "...", "players": [...]}`
- `GET /api/game/:gameId/view/:playerId` — Returns `PlayerGameView` as JSON for the given player
- `POST /api/game/:gameId/action` — Body: `GameAction` JSON → Applies action, returns updated `PlayerGameView` or error

**WebSocket Endpoint:**
- `GET /ws/game/:gameId/:playerId` — Upgrades to WebSocket:
  - **Incoming:** JSON `GameAction` messages → applied via `GameActor.applyAction`
  - **Outgoing:** `PlayerGameView` JSON pushed on every state change (subscribe to `topic`, map through `PlayerGameView.forViewer`)

### File: `backend/src/main/scala/durak/Main.scala`

Update to:
1. Create a `GameManager`
2. Build `GameRoutes.routes(manager)`
3. Start `EmberServerBuilder` on `0.0.0.0:8080` with the routes
4. Log `"Durak server running on 0.0.0.0:8080"`

### Test File: `backend/src/test/scala/durak/server/GameActorSuite.scala`

- Create a game room → initial state has correct phase and player count
- Apply valid `InitialAttack` → state updates, new state published to topic
- Apply invalid action → returns `Left(error)`, state unchanged
- Multiple sequential actions (attack → defend → pass) progress the game

### Test File: `backend/src/test/scala/durak/server/GameRoutesSuite.scala`

- `POST /api/game/create` returns 200 with `gameId`
- `GET /api/game/:id/view/:playerId` returns valid `PlayerGameView` JSON
- `POST /api/game/:id/action` with valid action returns updated view
- `POST /api/game/:id/action` with invalid action returns 400 with error message
- Non-existent `gameId` returns 404

## Acceptance Criteria
- [ ] Game actor manages state atomically
- [ ] REST endpoints create games, return views, and process actions
- [ ] WebSocket endpoint streams filtered views
- [ ] `Main.scala` boots the server successfully
- [ ] All tests pass

## Verification Command
```bash
cd backend && sbt test
```

