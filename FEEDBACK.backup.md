<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->
# Previous items from interactive QA playbook
3. The glowing box still doesn't hug the cards correctly. Additionally, it does not display after a first card has been played. The correct spec should be that it displays for all players that are able to throw in after the initial attack has been played.
4. The light theme colors are correct, but none of the table choices display much of a texture compared to dark theme. Adjust the light theme choices for the table so that the same texture is displaying in both themes - the only adjustment between themes should be in the color palette itself.
7. Make the following adjustments to the discard pile: remove the counter for the number of discarded cards; implement the same overlapping logic used to display hands to ensure the discarded cards always fit in the discard pile box element; enlarge the cards to match the size of the deck.
8. Everything works correctly. However, adjust the dashed arrow reflection outline so that it always is perfectly aligned vertically with the other cards in play.
9. The game-over banner does not pop up when a game is finished. Fix this.
12. The interactive game review mode is not accessible - when the game finishes, visiting its URL displays Loading game [game ID] forever.
13. Adjust this feature so that (You) is appended to the end of the active user's name in both the POV element and the player list element.

# Optional Follow-Up Question Responses
- In-Memory Replay Persistence: Let's defer this for later.
- Keyboard Arrow Shortcuts in Review Mode: Make the left and right arrow keys also step backward and forward through replay frames.
 






# Additional new requests
1. Adjust the card sprites - the pips on the card should never overlap the card's rank symbol (this is currently a problem for 10s specifically). Additionally, make the background of the card fronts (where the pips are drawn) theme-dependent; they should be white in the light theme, and grey in the dark theme.
2. Set RandomBot to play its moves instantly. BasicBot should keep its random delay between moves it has now.
