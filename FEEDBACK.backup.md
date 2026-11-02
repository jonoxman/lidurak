<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->
Here is the output in the server log after a game was played with a random bot:
  VITE v5.4.21  ready in 1197 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://172.17.0.2:5173/
[info] welcome to sbt 1.9.8 (Debian Java 17.0.21)
[info] loading project definition from /workspace/backend/project
[info] loading settings for project root from build.sbt ...
[info] set current project to durak-backend (in build file:/workspace/backend/)
[info] compiling 7 Scala sources to /workspace/backend/target/scala-3.3.3/classes ...
11:31:20 PM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16)
[info] done compiling
[info] compiling 7 Scala sources to /workspace/backend/target/scala-3.3.3/classes ...
11:31:21 PM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x2)
11:31:22 PM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x3)
11:31:23 PM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x4)
[info] done compiling
11:31:24 PM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x5)
[info] running (fork) durak.Main
11:31:24 PM [vite] http proxy error: /api/health
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x6)
[error] [io-compute-1] INFO org.http4s.ember.server.EmberServerBuilderCompanionPlatform - Ember-Server service bound to address: [::]:8080
[info] Durak server running on 0.0.0.0:8080
[error] [io-compute-10] INFO durak.server.GameActor - RandomBot plays CoverCard as p1 in game OwNMkPGb
[error] [io-compute-10] INFO durak.server.GameActor - RandomBot plays InitialAttack as p1 in game OwNMkPGb
[error] [io-compute-10] INFO durak.server.GameActor - RandomBot plays DeclareSurrender as p1 in game OwNMkPGb
[error] [io-compute-0] INFO durak.server.GameActor - RandomBot plays RedirectAttack as p1 in game OwNMkPGb
[error] [io-compute-0] INFO durak.server.GameActor - RandomBot plays PassTurn as p1 in game OwNMkPGb
[error] [io-compute-11] INFO durak.server.GameActor - RandomBot plays RedirectAttack as p1 in game OwNMkPGb
[error] [io-compute-9] INFO durak.server.GameActor - RandomBot plays PassTurn as p1 in game OwNMkPGb
[error] [io-compute-9] INFO durak.server.GameActor - RandomBot plays CoverCard as p1 in game OwNMkPGb
[error] [io-compute-9] INFO durak.server.GameActor - RandomBot plays DeclareSurrender as p1 in game OwNMkPGb
[error] [io-compute-9] INFO durak.server.GameActor - RandomBot plays CoverCard as p1 in game OwNMkPGb
[error] [io-compute-3] INFO durak.server.GameActor - RandomBot plays InitialAttack as p1 in game OwNMkPGb
[error] [io-compute-3] INFO durak.server.GameActor - RandomBot plays ThrowInCards as p1 in game OwNMkPGb
[error] [io-compute-3] INFO durak.server.GameActor - RandomBot plays PassTurn as p1 in game OwNMkPGb
[error] [io-compute-3] INFO durak.server.GameActor - RandomBot plays DeclareSurrender as p1 in game OwNMkPGb
[error] [io-compute-7] INFO durak.server.GameActor - RandomBot plays DeclareSurrender as p1 in game OwNMkPGb
[error] [io-compute-7] INFO durak.server.GameActor - RandomBot plays CoverCard as p1 in game OwNMkPGb
[error] [io-compute-7] INFO durak.server.GameActor - RandomBot plays CoverCard as p1 in game OwNMkPGb
[error] [io-compute-7] INFO durak.server.GameActor - RandomBot plays InitialAttack as p1 in game OwNMkPGb
[error] [io-compute-7] INFO durak.server.GameActor - RandomBot plays PassTurn as p1 in game OwNMkPGb
[error] [io-compute-7] INFO durak.server.GameActor - RandomBot plays CoverCard as p1 in game OwNMkPGb
[error] [io-compute-5] INFO durak.server.GameActor - RandomBot plays DeclareSurrender as p1 in game OwNMkPGb
[error] [io-compute-5] INFO durak.server.GameActor - RandomBot plays DeclareSurrender as p1 in game OwNMkPGb
[error] [io-compute-5] INFO durak.server.GameActor - RandomBot plays CoverCard as p1 in game OwNMkPGb
[error] [io-compute-5] INFO durak.server.GameActor - RandomBot plays DeclareSurrender as p1 in game OwNMkPGb
[error] [io-compute-5] INFO durak.server.GameActor - RandomBot plays DeclareSurrender as p1 in game OwNMkPGb
[error] [io-compute-3] INFO durak.server.GameActor - RandomBot plays RedirectAttack as p1 in game OwNMkPGb
[error] [io-compute-3] INFO durak.server.GameActor - RandomBot plays CoverCard as p1 in game OwNMkPGb
[error] [io-compute-3] INFO durak.server.GameActor - RandomBot plays CoverCard as p1 in game OwNMkPGb
[error] [io-compute-1] WARN durak.server.GameActor - Invalid action PassTurn from player p0: Cannot pass during GameOver phase
[info] Invalid action PassTurn from player p0: Cannot pass during GameOver phase
[error] [io-compute-9] WARN durak.server.GameActor - Invalid action PassTurn from player p0: Cannot pass during GameOver phase
[info] Invalid action PassTurn from player p0: Cannot pass during GameOver phase

1. In the above game, the bot redirected a card when the user had no cards left in their hand. Then, the bot played to cover its own cards. Redirecting in this way should never be possible, it is an illegal move. Resolve these issues, and ensure that the bot can only ever make legal moves in any given situation.
2. The ping indicator works correctly, but I want one modification - when there are 2 bars, they should be colored yellow, and when there is 1 bar, it should be colored red. Only 3 and 4 bars should be green.
3. In the sound menu, adjusting the volume slider should only play one sample sound when the mouse is released from the selector - currently, it plays a sound every time the slider moves.
4. Make the non-colorful card backs change to accommodate the current theme. As is, they look good in the dark theme but bad in the light theme. This change should not apply to the colorful card backs.
5. The back to lobby element is barely visible in the light theme. Give it more contrast in that theme specifically (it looks good in the dark theme).
6. Place the counter for the number of cards in the deck on the top left of the deck instead of on the bottom right.
7. There is a tinted box that appears in the play area currently, where the cards are placed. Instead of having it dynamically change in size with the number of cards in play, make the box a fixed size relative to the table size (it should still scale with the window size, however). 
8. The highlighting box around the active user's cards when it is their turn to play is not aligned property with the actual cards in the hand. Make sure that the cards are always exactly inside of this box.
9. Place the hand sorting dropdown outside of the play area - it should be in its own box element under where the box holding the deck is. 
10. Add a 'DECK' title to the box containing the deck. Center the position of the deck within the box, instead of having it on the left side. (The exposed trump card and TRUMP indicator should be repositioned along with the deck - keep their relative positions the same.) 
11. When a player surrenders, visually indicate this by shifting all of the cards in play towards the area of the game table close to their player box. 
12. Center the non-user player's cards within their player box. Instead of text writing 'N cards' under the cards, display a counter oval on the top left of their hand, similar to how the deck will now be counted.
13. Implement a more sophisticated bot, "BasicBot" - this bot should always play legal moves as RandomBot does, but when possible, it should always try to defend or redirect as opposed to surrendering. On its own turn, it should always try to play the lowest-ranked non-trump card in its hand, if possible (if the bot only has trumps, it should play a random trump instead). If another player surrenders, the bot should throw in any cards that it is legal to play, as long as they are not trumps. Add this bot to the dropdown below RandomBot, so the user can play with it.
