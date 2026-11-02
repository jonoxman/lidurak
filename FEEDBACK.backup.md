<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->
Here is the output from the server log:
  VITE v5.4.21  ready in 643 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://172.17.0.2:5173/
[info] welcome to sbt 1.9.8 (Debian Java 17.0.21)
[info] loading project definition from /workspace/backend/project
[info] loading settings for project root from build.sbt ...
[info] set current project to durak-backend (in build file:/workspace/backend/)
[info] compiling 8 Scala sources to /workspace/backend/target/scala-3.3.3/classes ...
12:46:06 AM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16)
12:46:07 AM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x2)
12:46:08 AM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x3)
12:46:09 AM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x4)
12:46:10 AM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x5)
12:46:11 AM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x6)
12:46:12 AM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x7)
[info] done compiling
[info] running (fork) durak.Main
12:46:13 AM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x8)
[error] [io-compute-2] INFO org.http4s.ember.server.EmberServerBuilderCompanionPlatform - Ember-Server service bound to address: [::]:8080
1. The above output is being flooded with these connection errors. Resolve the issue causing them, so that the output is clean and easily readable moving forward.
2. The loading wheel is frozen when the server is first starting. It should have the typical spinning animation.
3. The highlighting box for the user's cards when they are on the move is still not aligned correctly with the cards. It is critical that they are perfectly aligned, so make a robust implementation that does not depend on guessing the positions of the cards.
4. Make the color choices for the table theme-dependent. The current design looks good in dark theme, but is way too dark in light theme. When switching to light theme, the colors should be made paler to match the light theme aesthetic (and vice versa when switching to dark theme).
5. The connection bar with the ping seems to be working correctly, so remove the lag-switch feature entirely from the project.
6. Slightly reduce the size of the gold circle on trump cards so that it can never overlap the pips on the cards.
7. Implement a discard pile feature. The specification is as follows. All cards that go out of play go to the discard pile. In general, these cards are not visible to the players. However, only the cards from the last round (being defined as an attack or series of attacks that ended in a successful defense by a player) should have their values visible. Place the discard pile in the same box as the deck.
8. Double-clicking a card in your hand which can only be legally be played as a redirect move should automatically play that redirection.
9. When the game is detected to be over, a banner should pop up declaring the winner. The banner should have on it a button to return to the lobby.
10. Implement a timer feature for the whole game overall. The timer starts counting up when the first move of the game is made, and stops when the game has ended. Display this timer in the same element as the turn timer (split the element in two halves vertically)..
11. Implement game serialization: the entire game, move from move, should be recorded and saved temporarily (for now - later we will implement a permanent game database). Include all details needed to replay the exact same game from start to finish - this includes all game state features, such as the number of cards in the deck (and their order), the active trump suit, which player's turn it is at any given time, and so on. Be sure to account for edge cases; one tricky example is if a player plays two paired cards one after the other in quick succession, before another player responds (these should count as separate moves). Record along with the moves made the time on the game timer at which they were made - this will serve as a record of the time eacch player took to make a move.
12. Implement a game review mode. If the user visits the URL for a game that has already finished, they should be able to scroll through the serialized moves and view them played live on the board. The UI should look exactly like the UI during gameplay, but without any of the command buttons (ex. Pass, Surrender, Throw In). User-side only functionality, such as the hand sorting feature, should still work in this mode. There should be a left and right navigation button in the bottom left of the page (under the "HOW TO PLAY" element) - when clicked, these buttons should scroll through the moves made in the game one at a time. The time the moves were made at (relative to the start of the game) should be displayed in the timer element within the game clock, which should not tick in this mode but be frozen at the precise times the moves were made. 
13. Rename the "hotseat" menu to the "POV" menu. In this menu, display all players by their name, rather than naming the active user just "You". 
14. The turn clock should tick for every player in the throw-in phase, either when a player surrenders or is in the middle of a defense. If it runs out for a user, that user should automatically pass. Place a matching countdown on the pass button in the user's UI in this case, the same as the surrender button's 3-second timer currently looks. 
15. Move the trump card at the bottom of the deck in the deck element a few pixels right and a few pixels up relative to the vertical deck - it slightly sticks out the left and bottom sides right now.
