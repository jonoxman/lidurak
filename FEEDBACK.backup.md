<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->
#QA Playbook Responses
6. When I said "smooth" I meant that the frame rate of the animation feels a little choppy. In fact, for the way the animation looks, I want the opposite of this change: only the cards very close to the cursor should part at all, with most cards remaining overlapping as the size of the hand demands. Try to implement this and improve the performance/framerate of the animation, if possible.

# New
1. Potential bug: In the Table Collapse QA scenario, the active user can send only one card to attack, even though there are two valid cards to play. I don't see a reason for this, since the target player has 4 cards remaining in hand. 
2. Implement the card parting animation for when the user drags cards around in their hand as well - the cards should part in a way that makes it obvious which slot the dragged card will end up in if let go.
3. Reduce the time spent for the bots to make their moves by 75%.
