<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->
# QA Playbook
1. Sliding the palette intensity slider doesn't seem to affect the glow around player boxes. Fix this - additionally, rename the slider from "Intensity" to "Glow".
3. In dark mode, all status labels are the same color, while in light mode, they are different colors and have a border (in dark mode, only DURAK has a border). Adjust the light mode version to be consistent with dark mode, keeping the color slightly darker for more contrast.
4. Rename the slider in this section from "Intensity" to "Glow". 
5. Restore the dropdown menu that was there before, instead of this new button UI. Keep the new Custom option in this dropdown.
6. The function works correctly, but the animation is off. Set it up so that when the dragged card is moved away from its original position, the other cards move to close the gap (as if the card has been taken out of the hand entirely). After this, the cards should move apart to create gaps as is currently being done when the card is dragged into their position. 
7. This is still not correct - with this latest change, the cursor now looks like the standard mouse pointer, instead of the link-hovering pointer finger.
8. This outline should still display even if players don't have any cards they can legally place into it. 
10. In the low-detail cards, there is no need to display the trump highlight icons. However, give the low-detail trump cards the same gilded border that the large trump cards have, as in point 12.
12. Remove the circles and extra suit symbols signifying a trump card altogether, keeping only the gilded border.
13. The cards look correct, but the card-highlighting outline for the user broke again. Adjust it so that it perfectly encompasses all of the cards. Additionally, in the hand, keep the cards closer together - they should overlap by about 10% of the card width at minimum, to mimic how cards are actually held in a hand. Make this same change also for the cards inside the non active user's player boxes.
# New Tasks
15. The highlight glow around incoming cards has a slight glitchy and jerky visual effect to it. Fix this, make sure that the animation is smooth with no bugs. Also double-check that this doesn't happen to other glow elements I didn't notice in testing.
16. Rename the REPLAY section to REPLAY CONTROLS
17. Make the card outlines for face-down cards in dark mode brighter, for more visibility. 
