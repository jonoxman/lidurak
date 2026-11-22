<!-- Write your plain-English UI/UX feedback, bugs, or usability requests below this line. -->
<!-- Note: Your previous feedback is always backed up in FEEDBACK.backup.md and .reviews/feedback_archive/ -->

# Deferred Items from Previous Round (Amend or Answer Below When Ready)

1. 1. Collapse table cards together as they are covered if there is not sufficient space. As cards are played into the game table area, they should always stay collected in one row. If necessary, this will require reducing the gaps between the cards already on the table when a new card is added, or even allow overlap. Implement it as follows: Pairs of cards that are already covering/covered should be moved to the nearest vertical edge of the game table (left or right, depending on the target player), since they cannot be further interacted with directly. Multiple instances of these covering card pairs on the table should be overlapping maximally in such a way that the suit and rank of all cards is still visible, in a similar way to how the hand maximally overlaps. Remaining active as-yet uncovered cards should maintain a small gap between each other and the covered cards by default, but they can be allowed to overlap slightly if necessary to keep all cards on one single row in the game table area.
   - **[ORCHESTRATOR QUESTION TO RESOLVE]:** It is unclear whether covered pairs should always snap to a vertical edge immediately upon being covered or only collapse to the edge once the single row runs out of horizontal space, and which edge (left or right) should be chosen when the target defender sits at a centered seat (`top-center` or the bottom player).
   - **[SUGGESTED OPTIONS]:** Option A: Always move covered pairs to the edge vs. Option B: Keep normal row spacing until horizontal space runs out, then collapse covered pairs to the edge; and for centered defenders (`top-center` / bottom), default to Left edge vs. Right edge vs. Split symmetrically.
   - **[YOUR DECISION]:** 

