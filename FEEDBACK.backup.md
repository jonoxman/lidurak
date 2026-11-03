<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->
# Interactive QA Playbook Responses

3. The position is now correct, but the outline looks a little strange when all of the player's cards are legal to play (for example on the first attacked). In this case only, move the entire outline to the cards' adjusted-upward position (if at least one card is not legal to play, the outline should be located as it is now).
4. The texture looks correct. However, modify the default table brightness slightly - it should be a little darker in light mode, and a little lighter in dark mode (the dark mode version of the table should still be darker than the light mode version, however). Note that the sliders visible to the user should stay at their current default position - it is the absolute brightness that should be modified.
7. The overlap logic should only apply to the visible discard pile cards - the face-down cards should always remain in a single stack. Mousing over the face-down cards in the discard pile should not trigger any animation the way mousing over cards in the players' hands does.
9. Add to the banner also a "Rematch" button which starts a game with the same players (and/or bots).
12. Modify the following details about the review feature: when switching players in the POV menu, the replay move should not reset to the last move of the game as it currently does; sounds should be replayed as their moves are replayed in the viewer; "non-moves" (for example, passing when throwing in after a surrender) should not be considered as moves for the purposes of the replay - that is, every move should be a visible action on the table.


# Optional Follow-Up Questions
- Chaos Mode Engine Target Selection: Chaos mode should be implemented completely now. Make sure the UI is completely compatible - in Chaos mode, multiple players will have a card outline in front of them visible to the active user, for instance).

# Addtional Feedback

1. The deflect arrow in the 3 player mode points in the wrong direction. With default player names, when Alice plays against Bob, from Bob's POV the arrow is pointing at Alice in the top-left of the table, when it should be pointing at Carol in the top-right.
2. Mark the currently attacking, and currently attacked, players in the PLAYERS element on the right of the page by outlining each player's name tag with the appropriate color highlight.
3. The way the shaded play area shifts depending on the active player makes no sense. Instead of the shaded play area itself shifting, it should stay statically centred in the game table. Instead, move the cards and card outlines themselves close to the edge or corner of the play area corresponding to the target player (the view will be different from the perspective of each user). Always leave a small margin between the edge of the play area and the card outlines/positions.
4. When a player is in the process of surrendering (i.e. the player has selected surrender, and all that is being waited for is the other players to throw cards in) move the cards so that they are half on and half off the play area, with the half-off being in the direction of the surrendering player's player box (if the active user surrenders, the cards should move down, almost touching the cards in their hand). These cards should stay there until the surrender action is resolved by all non-defending players passing or having no further cards to throw in.
5. If a player has no cards to throw in, they should automatically pass during the surrender phase. There should be no timed delay for this.
6. When a player runs out of cards, the shaded play area expands to fill more of the game table space. This should never happen - the shaded play area should only change size to responsively accommodate window size changes and other similar external stimuli rather than user actions within the game.
7. With the discard pile, there are too many elements in the rightmost column. Move the SORT element to be below the game table in the UI. Also adjust its label to say HAND SORTING instead of simply SORT.
8. In the player list, keep the number of cards always in the center of the player's label so when a player goes out the text doesn't shift. Additionally, make sure that the last player out when the game ends also has the label "DURAK" assigned.
9. If a player is a bot, the game should not accept user input for that player's moves.
