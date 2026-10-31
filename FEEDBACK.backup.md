First, examine the git repo and merge in any necessary branches so we have one working branch. Then, implement the following feedback:

0. We get the following output when running the server:
  "VITE v5.4.21  ready in 726 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://172.19.0.3:5173/
[info] welcome to sbt 1.9.8 (Debian Java 17.0.21)
[info] loading project definition from /workspace/backend/project
[info] loading settings for project root from build.sbt ...
[info] set current project to durak-backend (in build file:/workspace/backend/)
[info] compiling 8 Scala sources to /workspace/backend/target/scala-3.3.3/classes ...
[warn] -- [E121] Pattern Match Warning: /workspace/backend/src/main/scala/durak/engine/GameEngine.scala:78:11
[warn] 78 |      case other =>
[warn]    |           ^^^^^
[warn]    |Unreachable case except for null (if this is intentional, consider writing case null => instead).
[warn] there was 1 deprecation warning; re-run with -deprecation for details
[warn] two warnings found
[info] done compiling
[info] compiling 5 Scala sources to /workspace/backend/target/scala-3.3.3/classes ...
[warn] there was 1 deprecation warning; re-run with -deprecation for details
[warn] three warnings found
[info] done compiling
[info] running (fork) durak.Main
[error] SLF4J: Failed to load class "org.slf4j.impl.StaticLoggerBinder".
[error] SLF4J: Defaulting to no-operation (NOP) logger implementation
[error] SLF4J: See http://www.slf4j.org/codes.html#StaticLoggerBinder for further details.
[info] Durak server running on 0.0.0.0:8080"

Refine the implementation to fix these problems so that the code is as clean as possible (genuinely fix the cause if possible; do not simply suppress warnings). Especially the logging bug is high priority since it potentially means we cannot see any logs from the server.
1. Display the deck of cards and the revealed trump suit in an overlapping T-shape instead of adjacent to one another.
2. Make the black suites (spades and clubs) much darker on the cards. Instead of the current grey, the pips and symbols should be a sharply contrasting black.
3. Customize card sprites: instead of just one pip of the suit, display the number of pips equal to the rank (for cards 2-10). Aces should have only one pip, but larger and ornate, with a total width of about half of the card's width. J, Q, and K cards should display the letters J, Q, and K respectively, with decorative suit pips placed around the letter. Keep the color design matching the current cards.
4. The trump indicator on the cards is not drawn correctly. The symbol for the trump suit should be centred within the yellow circle.
5. If the size of the window allows, the overall size of the cards should be larger. Make any card-size based designs (for example the outlines on which players are to drag the cards) match the card size.
6. Add to the top of every page a header bar. The specs are as follows: 
a) On the left end of the header bar should be the current LIDURAK "logo" - this should be a link that changes color interactively when moused over, and it should link back to the home page of the site. Place to the left of the logo some empty margin space (in the header bar only) so that it floats a little away from the left side of the window.
b) Next to the logo, there should be as many a series of dropdown menus that open when moused over. To start out, let's make 4 menu which are titled "PLAY", "PUZZLES", "LEARN", and "WATCH" For now, put a few placeholder links into each dropdown menu. 
c) On the right end, with some floating margin on the right in the same way as on the left, place the user's account name. This should light up in a different color than the logo link. Since for the moment we have no user accounts, use a placeholder user name, along with a typical SVG user profile icon (person inside a circle). When clicked, this element should make a dropdown with a list of options, including Profile, Inbox, Preferences, Sign out, Language, Sound, Theme, Table, and Card Back. At the bottom of the dropdown should be displayed a connection tracker which tells the user their current ping and server delay (one row each for these metrics, appearing on the left of the dropdown - on the right side should be an animated 4-bar indicator for the ping, which changes based on the strength of the connection. In each other dropdown element, place on the left side an icon representing the dropdown element's functionality. IMPORTANT: There is no need to implement any elements aside from what is explicitly mentioned in this spec - unimplemented elements will serve as placeholders. Design this section to be very extensible in later development.
d) The header bar should be a very slightly different shade compared to the rest of the page. The whole header bar should be this different shade. Make a gradient effect in the shading of the rest of the page so that the shade seamlessly transitions between the colors of the header bar and the rest of the page.
7. Implement the Sound functionality in the dropdown bar. For this, create 5 different sound packs (each pack should have a different style of sounds for every action in the game - make the sound styles match closely within each pack, i.e. don't use a complex musical tone for one action and a dull single-beat thud for another action within the same soundpack). Name each sound pack. Allow the user to choose between the sound packs by clicking the Sound section of the user profile dropdown, which should open a secondary dropdown with an interactive volume slider (which applies only for the current user, not for other players in a game) as well as clickable options to select each sound pack - the selected sound pack determines which sounds play for the user. The options should highlight in a pale version of the main green color we are using throughout the site when hovered over. Place also a right-facing green chevron on the right of the Sound button in the profile dropdown menu, to indicate it has a submenu.
8. Implement the Theme functionality in the dropdown bar. Visually, the spec is identical to the Sound spec, except instead of choosing sounds the user chooses between three options: Device theme, Light, and Dark. No volume slider on the side here - instead, there should be a Roundness slider below the Device theme, Light, and Dark options which defaults to 8px and scales from 0px to 16px - 0px makes all webpage elements completely square with sharp corners, while 16px makes them more rounded. Add also the green chevron to the Theme button in the profile dropdown. Clicking Device theme, Light, and Dark changes the theme of the website as one might expect - choose appropriate colors for Light theme (what we currently have will be the Dark theme) matching the aesthetic we are trying to deliver.
9. Implement the Table functionality in the profile dropdown bar. Visually, the spec is similar to the previous two features. This dropdown should have a grid of textures the user can select to choose how the table looks (this is the play area where the cards are placed). Generate (or use a library for) a selection of textures (at least 6) and store these in a project file - later on, we will implement a feature allowing the user to upload their own textures, and possibly create our own custom textures to be saved in this location. Display small previews of these textures in the grid mentioned above. Also include three sliders - Brightness, Contrast, and Hue, allowing the user to customize their game table texture in real time as they like. Add to the Table element in the dropdown a green chevron as in the previous elements. Keep the textures generated for this feature in line with the overall aesthetic of the site.
10. Implement the Card Back functionality in the profile dropdown bar. This should simply be a grid view of options for the patterns on the back of the cards. As with the table textures, generate at least 6 choices for card back textures, keeping with the overall aesthetic of the site. 
11. Instead of three buttons "Suit" "Pairs" and "Rank" next to the user's hand in the current implementation, make one clean dropdown to select these options in the same location to take less screen space.
12. In the user's hand, automatically shift the cards that are currently legal to play upwards slightly to give a visual indication of which moves are legal to play.
13. In the Hotseat menu, don't reorder the players to put the active player at the top. Instead, keep the players' positions fixed in the menu. The same should apply to the Players section on the right of the page.
14. Currently, the activity clock doesn't seem to ever tick down. In case this feature request was missed: Whenever a player is being waited on to make an action, their clock starts ticking. When the clock runs out, the player automatically makes a random legal move (which can include passing, throwing in, defending, attacking, or surrendering). Each player clock resets whenever a player takes an action. Display each player's clock in a small format above each player's player box (where their card deck is held). A ticking sound should play for only the user whose clock is ticking when the clock goes below 5 seconds.
15. Make the sizes of every player's box other than the user's equal.
16. Reduce the length of the game ID in the link and all internal tracking; games should have an ID of at most 8 characters, which should only be letters and numbers. 
17. The Back to lobby link at the top right of the game page should be a button element and match the rest of the aesthetic of the site.
18. If a player is being attacked and has no legal way to defend, they should automatically surrender after 3 seconds (or they can press the button before then).
19. Clicking and dragging a card turns the mouse cursor into a no symbol (circle with slash through it). Instead, the cursor should remain the "clickable element" pointer finger symbol throughout dragging the mouse.
20. It should not be possible under any circumstance to highlight text that appears in the game elements. This includes anything in the play area, as well as all buttons and timers. The only exceptions are the game ID, HOW TO PLAY section, and the players' names.
21. Currently, the same color is being used to highlight the player who is about to attack and the player who is about to be attacked. Modify this to be two different colors. The color for the attacking player should match the highlight of their hand.
22. Make the highlight box for the hand of the attacking player (from their point of view only) tightly fit around the cards instead of leaving space as it is now.

