<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->
# Previous item responses
7. This version looks better - however, ther should be more space for the face-up discarded cards. Allow them to overlap the face-down deck itself. The left-most revealed card should overlap the deck with the maximally allowed margin, with the other revealed cards being spread evenly across the space (and the mouse animation only applying if there are too many cards, as usual).

# Additional Feedback responses
1. The arrow direction is pointing at the correct player box. However, the player boxes are not in the correct position. They should be arranged in a realistic way relative to the active user's POV. For example, if when Alice is the active user, Bob is on the left, and Carol is on the right, then when Bob is the active user, Alice should be on the right and Carol should be on the left. Adjust the logic, making sure it is consistent for any number of players.
2. Do not outline the players' names inside of the label box. Additionally, make the box outlines in the player section a much softer glow effect, rather than the sharp boxes we have now. 
4. This feature does not appear to be working. Firstly, due to auto-surrender (Additional Feedback #5), there is no surrender button to click when the QA test starts. Second, in the pass phase (where the straddling effect should be visible) the cards are still in their play location, rather than halfway off the play area.
8. The active user's player label doesn't display their label in the player list unless they are the DURAK. Additionally, in this QA scenario, Bob is displayed as OUT even though he still has 3 cards in hand. Correct both of these. 

# New Additional Specifications
1. The roundness slider in the theme menu should also affect all elements in the game table, including cards and the borders of the game table itself.
2. Place cards in the play area closer together, with slight overlap if necessary, to keep all cards in play in the area of the table close to the defending player. Move the card outlines accordingly. Cards should never appear in two rows if there are too many to fit in one row in the play area, instead being overlapped together (but the left part of every card, where the suit and rank is shown, should always be displayed). 
3. Use a slightly fancier, serifed font for the numbers and letters on the card sprites. 
