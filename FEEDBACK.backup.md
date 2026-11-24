<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in BACKUP_FEEDBACK.md and .reviews/feedback_archive/ -->
# QA responses
6. Clicking the quick pairing 2P 15s tile displays the searching status for a split second, but immediately places the user into the new room that was just created. The correct behavior would be that players in the quick pairing queue are not considered to be active players within a room until a match has been found, so they should stay on the lobby screen with the searching status until then.

# New

1. The lobby quick pairing tiles should be adjusted to be about double their current height (keep the layout the same). Rename the third section (currently "Create Invite Link") to "Create a Game" and rearrange the UI within this section: the first choice should be if the game is a private link or not, followed by the rest of the options as currently arranged.
2. Adopt the style of the Milestone 1 design for these newly created lobby elements. All elements respond appropriately to the choice of theme in the profile menu. 
3. Hook in the original gameplay interface as was developed in Milestone 1 for all gameplay elements. The current lightweight placeholder interface should be removed from the project completely. 
4. Minor visual change to the hand animation in the gameplay interface for Milestone 1: if the active user's hand is small enough not to fill the maximal allowed width, its width should still be kept constant when the mouseover animation plays. In other words, mousing over the hand should never increase the overall width of the hand, but only spread apart and push together cards as necessary.
