### Code Review Summary

The implementation of **T-11: PlayerGameView Projection & Circe JSON Codecs** has been reviewed against all requirements and acceptance criteria.

---

### Key Findings & Analysis

1. **State Projection & Hidden Information Boundary (`PlayerGameView.scala`)**:
   - `forViewer` strictly strips secret state: opponents' hands are reduced to `PublicPlayerSummary` (`cardCount`, `hasPassed`, `finishRank`), the talon order and discard pile are excluded entirely, and `bottomTrumpCard` is correctly set to `None` when `talon.isEmpty`.
   - Unknown `viewerId` validation is enforced with an `IllegalArgumentException`.
   - Action calculation (`legalActionsFor`) properly handles bout phases (`InitialAttack`, `Defense`, `SurrenderThrowIn`, `BoutOver`, `GameOver`), respects player activity/finish status, and evaluates covering, redirecting, surrendering, passing, and throwing-in constraints according to Durak rules.

2. **Circe Serialization (`JsonCodecs.scala`)**:
   - `Suit` and `Rank` codecs serialize to and deserialize from lowercase strings as required.
   - `Card` format conforms to `{"suit": "...", "rank": "..."}`.
   - `GameAction` encoding and decoding consistently uses the `"type"` discriminator field across all variants (`initialAttack`, `coverCard`, `redirectAttack`, `throwInCards`, `declareSurrender`, `passTurn`) with case-insensitive type matching on decode and descriptive failure messages.
   - Semi-automatic codecs for `TablePair`, `PublicPlayerSummary`, and `PlayerGameView` cleanly round-trip without manual boilerplate.

3. **Test Coverage (`PlayerViewSuite.scala` & `JsonCodecsSuite.scala`)**:
   - Comprehensive projection tests cover viewer hand isolation, opponent summarization, talon depletion, and legal action availability across defender/attacker/bystander roles.
   - Information leakage regression test asserts that opponent cards, talon cards, and the discard pile are never present in the serialized JSON.
   - Full round-trip tests verify all codecs, discriminator decoding, malformed input rejection, and full `PlayerGameView` serialization.

---

VERDICT: APPROVED
