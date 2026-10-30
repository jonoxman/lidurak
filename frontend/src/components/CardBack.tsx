export interface CardBackProps {
  class?: string;
}

/** The dark patterned back of a playing card, sized like a [[Card]]. */
export function CardBack({ class: className }: CardBackProps) {
  return (
    <svg
      class={`playing-card card-back${className ? ` ${className}` : ''}`}
      viewBox="0 0 70 100"
      role="img"
      aria-label="Card back"
    >
      <defs>
        <pattern
          id="card-back-hatch"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="8" height="8" fill="#262421" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="#3a3733" strokeWidth={3} />
        </pattern>
      </defs>
      <rect
        x="1"
        y="1"
        width="68"
        height="98"
        rx="6"
        ry="6"
        fill="#262421"
        stroke="#3a3733"
        strokeWidth={2}
      />
      <rect
        x="6"
        y="6"
        width="58"
        height="88"
        rx="4"
        ry="4"
        fill="url(#card-back-hatch)"
        stroke="#3a3733"
        strokeWidth={1}
      />
    </svg>
  );
}
