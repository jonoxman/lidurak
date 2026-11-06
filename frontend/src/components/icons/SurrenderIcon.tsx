/**
 * T-90-feedback-20261106_111512-2: a non-verbal surrender glyph on the same
 * 32x32 grid as the Pass icon — two small fanned cards in the upper third, an
 * arrow pointing down out of them, and two open hands raised in surrender whose
 * wrists rest on the bottom edge. Drawn with `currentColor` so the button's
 * theme colors the glyph.
 */
export function SurrenderIcon() {
  return (
    <svg
      class="action-icon"
      data-testid="surrender-icon"
      data-icon="surrender-hands-cards"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {/* Two fanned playing cards, faintly filled so they read at 28px. */}
      <g data-icon-part="cards">
        <rect
          x="10.4"
          y="2.4"
          width="6"
          height="8.4"
          rx="1.2"
          fill="currentColor"
          fill-opacity="0.16"
          transform="rotate(-12 13.4 6.6)"
        />
        <rect
          x="14.6"
          y="2.4"
          width="6"
          height="8.4"
          rx="1.2"
          fill="currentColor"
          fill-opacity="0.16"
          transform="rotate(10 17.6 6.6)"
        />
      </g>

      {/* The cards leave the hands: shaft plus chevron head, pointing down. */}
      <g data-icon-part="arrow-down">
        <path d="M16 13.2 V 17.2" />
        <path d="M13.6 15 L16 17.4 L18.4 15" />
      </g>

      {/* Two open palms facing the viewer, four fingers each and a thumb,
          mirrored about the centre line, wrists on the bottom edge. */}
      <g data-icon-part="raised-hands">
        <path d="M3.4 22 v6.3 a1.9 1.9 0 0 0 1.9 1.9 h6.4 a1.9 1.9 0 0 0 1.9-1.9 V22" />
        <path d="M5.1 22 V16.4 M6.9 22 V14.2 M8.8 22 V15.4 M10.6 22 V17.6" />
        <path d="M3.4 23.4 l-1.6-1.2" />
        <path d="M28.6 22 v6.3 a1.9 1.9 0 0 1-1.9 1.9 h-6.4 a1.9 1.9 0 0 1-1.9-1.9 V22" />
        <path d="M26.9 22 V16.4 M25.1 22 V14.2 M23.2 22 V15.4 M21.4 22 V17.6" />
        <path d="M28.6 23.4 l1.6-1.2" />
      </g>
    </svg>
  );
}
