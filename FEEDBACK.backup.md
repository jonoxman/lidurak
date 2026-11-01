<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->  
We have the following output in the server log after trying to create a game a few times, which may be related to the following issues in the document:
🎮 Starting Lidurak Local Server...
   -> Backend API / WS : http://localhost:8080
   -> Frontend UI      : http://localhost:5173
Press Ctrl+C to stop both servers.

> lidurak-frontend@0.1.0 dev
> vite --host 0.0.0.0 --port 5173 --host 0.0.0.0 --port 5173


  VITE v5.4.21  ready in 673 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://172.17.0.2:5173/
[info] [launcher] getting org.scala-sbt sbt 1.9.8  (this may take some time)...
[info] [launcher] getting Scala 2.12.18 (for sbt)...
[info] welcome to sbt 1.9.8 (Debian Java 17.0.21)
5:55:51 PM [vite] http proxy error: /api/game/create
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16)
[info] loading project definition from /workspace/backend/project
[warn] jline-2.14.6.jar no longer exists at /home/node/.cache/coursier/v1/https/repo1.maven.org/maven2/jline/jline/2.14.6/jline-2.14.6.jar
[info] loading settings for project root from build.sbt ...
[info] set current project to durak-backend (in build file:/workspace/backend/)
[warn] scala3-library_3-3.3.3.jar no longer exists at /home/node/.cache/coursier/v1/https/repo1.maven.org/maven2/org/scala-lang/scala3-library_3/3.3.3/scala3-library_3-3.3.3.jar
5:55:56 PM [vite] http proxy error: /api/game/create
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x2)
5:55:59 PM [vite] http proxy error: /api/game/create
Error: connect ECONNREFUSED 127.0.0.1:8080
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1638:16) (x3)
[info] running (fork) durak.Main
[error] [io-compute-7] INFO org.http4s.ember.server.EmberServerBuilderCompanionPlatform - Ember-Server service bound to address: [::]:8080
[info] Durak server running on 0.0.0.0:8080

Based on this log, the following should be corrected:
1. When the server first starts, the frontend page is possible to open before the server completely loads, making it impossible to create a game - creating a game gives a "Could not create game (HTTP 500)" error message. Make the UI display a loading page, rather than letting the user try to create a game before the server is ready.
2. The elements for the create a game page do not match the light theme. All elements in all pages should always adapt to the theme chosen by the user.
3. In all of the submenus in the profile menu dropdown, the following issue happens: the submenu pops out of the right side of the profile menu, which extends the page length. Instead, the submenu should replace the profile menu completely. At the top of each submenu should be an element with the name of the submenu and (on the left side) a left-facing chevron which when clicked closes the submenu.
4. Make the chevrons in this menu slightly larger.
5. The Ping and Server Delay section should be in all caps (except for the ms unit, which should be lowercase). Don't make the connection bar icon pulse constantly - instead, it should only animate when the connection worsens or improves, to update the number of bars visually with no other special visual effect.
6. Implement a "lag-switch" temporary development feature to manually set the ping and test the connection bar animation.
7. The card deck and displayed trump, along with the TRUMP suit indicator element, are incorrectly positioned. The card deck should be placed vertically, with the revealed trump being placed horizontally, sticking out on the right side of the deck (the left side of the horizontal trump card should be aligned with the left side of the vertically positioned deck, and centred vertically). The TRUMP suit indicator should be placed clearly below both of these elements with no overlap. Additionally, place all three of these elements on the right side of the screen, underneath the clock and PLAYERS list element.
8. Only players currently being waited on to play should see their clock timer element ticking down. For inactive players, it should remain frozen at 15 seconds.
9. Currently, if a player has too many cards in hand, their hand forms a second row within the bounding box. Instead, if there are too many cards to fit in the bounding box with the default pixel overlap, the cards should overlap more. In other words, the existing 8 pixel overlap should be the default (cards should never be farther apart than that) but if the player has more cards, the pixel overlap can increase to a maximum of the width of the cards' top-left pip count symbol (so the suit and rank of the card should always be readable). If the number of cards would exceed the maximum overlap, place all cards on one end of the hand behind the last card that can overlap within spec (they are overlapped 100%). However, in this case, the player must still be able to see all of their hand. To achieve this, dynamically move the cards from one end of the hand to the other depending on the position of the player's cursor as they hover over they hand - as the cursor moves from left to right, cards should move from the hidden stack on the right side to the hidden stack on the left, and vice versa. Apply this logic to the cards not being held by the user as well - in other players' hands, the player's box should be a fixed size, with cards overlapping more or less depending on their quantity, and a minimum degree of overlap (this should not respond to mouse movement, however)
10. After running a game for some time, we get the following errors in the server log:
[error] [io-compute-1] ERROR org.http4s.ember.server.EmberServerBuilderCompanionPlatform - WebSocket connection terminated with exception
[error] java.util.concurrent.TimeoutException: 60 seconds
[error]         at timeout @ org.http4s.ember.core.Util$.timeoutMaybe(Util.scala:106)
[error]         at main$ @ durak.Main$.main(Main.scala:8)
[error]         at timeout @ org.http4s.ember.core.Util$.timeoutMaybe(Util.scala:106)
[error]         at timeout @ org.http4s.ember.core.Util$.timeoutMaybe(Util.scala:106)
[error] [io-compute-7] INFO durak.server.GameActor - Turn clock expired in game 3M8Hlnun: auto-playing InitialAttack for p0
[error] [io-compute-0] INFO durak.server.GameActor - Turn clock expired in game 3M8Hlnun: auto-playing CoverCard for p1
[error] [io-compute-8] ERROR org.http4s.ember.server.EmberServerBuilderCompanionPlatform - WebSocket connection terminated with exception
[error] java.util.concurrent.TimeoutException: 60 seconds
[error]         at timeout @ org.http4s.ember.core.Util$.timeoutMaybe(Util.scala:106)
[error]         at main$ @ durak.Main$.main(Main.scala:8)
[error]         at timeout @ org.http4s.ember.core.Util$.timeoutMaybe(Util.scala:106)
[error]         at timeout @ org.http4s.ember.core.Util$.timeoutMaybe(Util.scala:106)
I'm not sure if these are related to letting the clock time out for a given player. Make sure these errors do not happen - fix the necessary problems, rather than suppressing them.
11. Use the textures in the Table subsection of the profile submenu to color the game table element (Emerald Felt by default). Make the brightnes, contrast, and hue sliders apply to the previews of the textures in real time, as well as to the game table area itself.
12. Add some more colorful options to the card backs in the Card Back section of the profile submenu.
13. When the user clicks to select a sound pack from the Sound menu, play a random sample sound from the pack being clicked. Do the same when the volume slider is adjusted (at the new volume).
14. Remove the LIDURAK that appears below the header bar - it is now redundant.
15. Create an SVG logo for the site and place it to the left of the LIDURAK link in the header bar. Keep the left and right margins as they are - all elements except the profile menu in the header bar will move to the right to acommodate the logo. The logo should also highlight in the same color as the LIDURAK text when moused over, and be part of the same link.
16. Implement a bot player agent. For now, only one level of bot should be made - RandomBot, which simply makes a random legal move whenever it is prompted. The bot should make its moves (or pass, surrender, and so on) on a random delay between 0.5 seconds and 2 seconds delay when it is prompted, to simulate a human player.
17. When creating a game, when inputting the player names, put a second dropdown for each player from which the user can select who will be playing - a human, or bot (each level of bot will appear in this dropdown, for now only one level of RandomBot).
18. Update the design for face cards (J, K, Q) - instead of arranging the extra pips for these cards in a simple diamond pattern, instead place the pips on the ends of the letter (J will have 3 pips, at the top-left, top-right, and bottom-left at the point of the J - Q will have one pip at the bottom-right point of the Q, and K will have 4 pips, one at each of the top-left, top-right, bottom-left, and bottom-right). For these cards, rotate the pips so that their distinguishing parts (these are the top half of the heart and club, and the bottom half of the spade and diamond are facing outwards from the letter. 
19. Place a dot next to each active player's name in the player list. This dot should be green when the player is present and playing (i.e the window is in focus and the mouse has moved in the last 30 seconds) and grey otherwise.

