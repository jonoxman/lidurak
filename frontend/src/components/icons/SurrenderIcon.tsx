/**
 * T-90-feedback-20261122_011021-2 ITEM-7: the Surrender glyph, redrawn on a
 * 48x48 grid so it stays crisp at the 36-44px the compact button renders it at.
 *
 * Reading order, top to bottom:
 * - a small fan of three playing cards (`data-part="cards"`),
 * - a downward arrow leaving the cards (`data-part="arrow"`),
 * - two open palms raised in surrender beneath them, each with four fingers and
 *   an outward thumb, wrists resting on the bottom of the glyph
 *   (`data-part="hands"`).
 *
 * Everything is stroked with `currentColor` (2.2 units, round caps/joins) so the
 * button's theme paints the glyph in parchment/emerald/gold rather than red.
 *
 * `data-icon`, `data-icon-part` and the `data-testid` are the stable hooks the
 * table's Wave-1 assertions and Wave 2 wiring rely on; `data-part` is the
 * ticket's semantic grouping.
 */
export function SurrenderIcon() {
  return (
    <svg
      class="action-icon"
      data-testid="surrender-icon"
      data-icon="surrender-hands-cards"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {/* Three cards fanned in the upper third: two tilted outer cards behind a
          centred upright one, faintly filled so they read as card silhouettes. */}
      <g data-part="cards" data-icon-part="cards">
        <rect
          x="14.8"
          y="5.2"
          width="7.6"
          height="11.4"
          rx="1.8"
          transform="rotate(-14 18.6 10.9)"
          fill="currentColor"
          fill-opacity="0.14"
        />
        <rect
          x="25.6"
          y="5.2"
          width="7.6"
          height="11.4"
          rx="1.8"
          transform="rotate(14 29.4 10.9)"
          fill="currentColor"
          fill-opacity="0.14"
        />
        <rect
          x="20.2"
          y="4"
          width="7.6"
          height="11.4"
          rx="1.8"
          fill="currentColor"
          fill-opacity="0.18"
        />
      </g>

      {/* The cards come down into the hands: a shaft with a chevron head. */}
      <g data-part="arrow" data-icon-part="arrow-down">
        <path d="M24 17.2 V23.6" />
        <path d="M20.8 20.4 L24 23.6 L27.2 20.4" />
      </g>

      {/* Two mirrored open palms, fingers up and thumbs out, wrists low. */}
      <g data-part="hands" data-icon-part="raised-hands">
        <path d="M5.4 30 v9.6 a2.4 2.4 0 0 0 2.4 2.4 h8.6 a2.4 2.4 0 0 0 2.4-2.4 V30" />
        <path d="M7.8 30 V24.6 M10.4 30 V22.6 M13 30 V23.6 M15.6 30 V25.6" />
        <path d="M5.4 31.4 l-2.2-1.6" />
        <path d="M42.6 30 v9.6 a2.4 2.4 0 0 1-2.4 2.4 h-8.6 a2.4 2.4 0 0 1-2.4-2.4 V30" />
        <path d="M40.2 30 V24.6 M37.6 30 V22.6 M35 30 V23.6 M32.4 30 V25.6" />
        <path d="M42.6 31.4 l2.2-1.6" />
      </g>
    </svg>
  );
}
