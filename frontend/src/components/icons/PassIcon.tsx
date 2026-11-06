/**
 * T-90-feedback-20261106_111512-2: the Pass glyph shares the Surrender icon's
 * grid, stroke weight and card stack, but pairs them with a flat palm-down hand
 * and a curved arrow that sweeps sideways past the cards — the card-table
 * "wave off / pass" gesture. Clearly different from the raised hands at 28px.
 */
export function PassIcon() {
  return (
    <svg
      class="action-icon"
      data-testid="pass-icon"
      data-icon="pass-wave-cards"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {/* The same small card stack as the surrender glyph, moved left. */}
      <g data-icon-part="cards">
        <rect
          x="3"
          y="2.4"
          width="6"
          height="8.4"
          rx="1.2"
          fill="currentColor"
          fill-opacity="0.16"
          transform="rotate(-12 6 6.6)"
        />
        <rect
          x="7.2"
          y="2.4"
          width="6"
          height="8.4"
          rx="1.2"
          fill="currentColor"
          fill-opacity="0.16"
          transform="rotate(10 10.2 6.6)"
        />
        <rect
          x="5.1"
          y="2.8"
          width="6"
          height="8.4"
          rx="1.2"
          fill="currentColor"
          fill-opacity="0.12"
          transform="rotate(-1 8.1 7)"
        />
      </g>

      {/* One flat hand, palm down and horizontal, waving the turn on. */}
      <g data-icon-part="pass-hand">
        <g transform="rotate(-7 17 27)">
          <path d="M12 24.6 h5.4 a2.4 2.4 0 0 0 2.4-2.4 a2.4 2.4 0 0 0-2.4-2.4 h-5.4" />
          <path
            data-icon-part="pass-fingers"
            d="M11.4 21.2 h2.6 M11.4 23.2 h3.2 M11.4 25 h2.8"
          />
          <path d="M13.8 26.8 l2.8 1.4" />
          <path d="M18.4 23.2 h1.6" />
        </g>
      </g>

      {/* The turn skips onwards: an arrow curving up and away past the cards. */}
      <g data-icon-part="arrow-pass">
        <path d="M6.2 21.4 C14.6 20.6 22.4 20.2 26.4 15.4" />
        <path d="M23.9 14.9 L26.7 15.2 L26.2 18" />
      </g>
    </svg>
  );
}
