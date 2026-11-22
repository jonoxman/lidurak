/**
 * T-90-feedback-20261122_011021-2 ITEM-8: the Pass glyph in the exact visual
 * language of [[SurrenderIcon]] — the same `0 0 48 48` grid, the same 2.2-unit
 * round-capped `currentColor` stroke, and the same palm/finger/thumb geometry.
 *
 * The cards are swept off to the upper left (`data-part="cards"`), a calm arc
 * carries the turn onwards past them (`data-part="pass-indicator"`), and a
 * single open palm — one hand, not the two raised in surrender — sits where the
 * player lets the turn go (`data-part="hand"`).
 */
export function PassIcon() {
  return (
    <svg
      class="action-icon"
      data-testid="pass-icon"
      data-icon="pass-wave-cards"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {/* The card stack, tilted away from the player toward the top left. */}
      <g data-part="cards" data-icon-part="cards">
        <rect
          x="6"
          y="6.4"
          width="7"
          height="10.6"
          rx="1.6"
          transform="rotate(-18 9.5 11.7)"
          fill="currentColor"
          fill-opacity="0.14"
        />
        <rect
          x="10.6"
          y="5.4"
          width="7"
          height="10.6"
          rx="1.6"
          transform="rotate(-8 14.1 10.7)"
          fill="currentColor"
          fill-opacity="0.14"
        />
        <rect
          x="15.4"
          y="4.6"
          width="7"
          height="10.6"
          rx="1.6"
          transform="rotate(4 18.9 9.9)"
          fill="currentColor"
          fill-opacity="0.18"
        />
      </g>

      {/* The turn skips onward: an arc leaving the cards with a forward head. */}
      <g data-part="pass-indicator" data-icon-part="arrow-pass">
        <path d="M7 20.4 C15.4 22.6 25 22 32 17.2" />
        <path d="M28.6 16.2 L32.2 17.2 L31.2 20.8" />
      </g>

      {/* One open palm, tilted slightly, letting the turn go. */}
      <g data-part="hand" data-icon-part="pass-hand">
        <g transform="rotate(-8 30 34)">
          <path d="M24.4 31 v9.6 a2.4 2.4 0 0 0 2.4 2.4 h8.6 a2.4 2.4 0 0 0 2.4-2.4 V31" />
          <path d="M26.8 31 V25.6 M29.4 31 V23.6" />
          <path d="M32 31 V24.6 M34.6 31 V26.6" />
          <path d="M24.4 32.4 l-2.2-1.6" />
        </g>
      </g>
    </svg>
  );
}
