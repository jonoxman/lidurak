export interface ActionBarProps {
  legalActions: string[];
  onAction: (action: { type: string }) => void;
  /** Seconds left before the automatic surrender, shown on the Surrender button. */
  surrenderSeconds?: number | null;
  /** Seconds left before the automatic pass, shown on the Pass button. */
  passCountdownSeconds?: number | null;
  /**
   * The viewed seat is played by a bot: a human inspecting it may never send a
   * command on its behalf, so no contextual button is rendered at all.
   */
  isBotSeat?: boolean;
}

interface ActionButton {
  action: string;
  type: string;
  label: string;
  testId: string;
  variant: 'green' | 'red';
}

const BUTTONS: ActionButton[] = [
  { action: 'pass', type: 'passTurn', label: 'Pass', testId: 'pass-btn', variant: 'green' },
  {
    action: 'surrender',
    type: 'declareSurrender',
    label: 'Surrender',
    testId: 'surrender-btn',
    variant: 'red',
  },
];

/**
 * T-90-feedback-20261105_221105-3 ITEM-6: a non-verbal surrender glyph — fanned
 * cards at the top, an arrow pointing down out of them, and two raised open
 * hands underneath. It replaces the old bright-red "Surrender" word.
 */
export function SurrenderIcon() {
  return (
    <svg
      class="action-icon"
      data-testid="surrender-icon"
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <g data-icon-part="cards">
        <rect x="8.6" y="1.8" width="5.4" height="7.4" rx="1.1" transform="rotate(-12 11.3 5.5)" />
        <rect x="10.4" y="1.8" width="5.4" height="7.4" rx="1.1" transform="rotate(10 13.1 5.5)" />
      </g>
      <g data-icon-part="arrow-down">
        <path d="M12 9.6 V13.8" />
        <path d="M9.9 11.8 L12 13.9 L14.1 11.8" />
      </g>
      <g data-icon-part="raised-hands">
        <path d="M3.4 21.8 H9.4" />
        <path d="M4.4 21.4 V17.6 M6.4 21.4 V16.4 M8.4 21.4 V17.6" />
        <path d="M14.6 21.8 H20.6" />
        <path d="M15.6 21.4 V17.6 M17.6 21.4 V16.4 M19.6 21.4 V17.6" />
      </g>
    </svg>
  );
}

/**
 * T-90-feedback-20261105_221105-3 ITEM-7: the Pass glyph shares the surrender
 * icon's stroke weight and scale — cards, a waving hand and a curved arrow that
 * arcs past the cards, so the two controls read as one family.
 */
export function PassIcon() {
  return (
    <svg
      class="action-icon"
      data-testid="pass-icon"
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <g data-icon-part="cards">
        <rect x="2.4" y="2.6" width="5.4" height="7.4" rx="1.1" transform="rotate(-10 5.1 6.3)" />
        <rect x="5.6" y="2.6" width="5.4" height="7.4" rx="1.1" transform="rotate(6 8.3 6.3)" />
      </g>
      <g data-icon-part="pass-hand">
        <path d="M9.2 21.6 V17.2" />
        <path d="M7.2 21.4 H11.4" />
        <path d="M9.2 17.4 L7.6 15.9" />
      </g>
      <g data-icon-part="arrow-pass">
        <path d="M11.4 14.4 a5.6 5.6 0 0 0 7.4-1.6" />
        <path d="M16.4 11.4 L19.1 12.5 L18.5 15.2" />
      </g>
    </svg>
  );
}

/**
 * Minimalist contextual bout controls: `Pass` for attackers waiting on
 * throw-ins, `Surrender` for a defender facing uncovered cards. Only actions the
 * server lists as legal are rendered. T-90-feedback-20261105_221105-3 ITEM-6/7:
 * both are compact, theme-matched, icon-only buttons that keep their bottom-right
 * seat beside the hand.
 */
export function ActionBar({
  legalActions,
  onAction,
  surrenderSeconds = null,
  passCountdownSeconds = null,
  isBotSeat = false,
}: ActionBarProps) {
  // A bot seat takes no user input, so neither `Surrender` nor `Pass` appears.
  if (isBotSeat) return null;

  const buttons = BUTTONS.filter((button) => legalActions.includes(button.action));
  const passCountdownActive = passCountdownSeconds != null && passCountdownSeconds > 0;

  if (buttons.length === 0) return null;

  return (
    <div class="action-bar">
      {buttons.map((button) => (
        <button
          key={button.action}
          type="button"
          class={`action-button action-icon-btn ${button.variant} ${
            button.action === 'pass' ? 'action-btn-pass' : 'action-btn-surrender'
          }`}
          data-testid={button.testId}
          aria-label={button.label}
          title={button.label}
          onClick={() => onAction({ type: button.type })}
        >
          {button.action === 'pass' ? <PassIcon /> : <SurrenderIcon />}
          {/* ITEM-6/7 (review round 1): the number is painted from
              `data-countdown` by CSS, so the icon-only button's textContent
              stays empty even while a countdown is running. */}
          {button.action === 'pass' && passCountdownActive ? (
            <span
              class="surrender-countdown"
              data-testid="pass-countdown"
              data-countdown={String(passCountdownSeconds)}
              aria-hidden="true"
            />
          ) : null}
          {button.action === 'surrender' && surrenderSeconds != null && surrenderSeconds > 0 ? (
            <span
              class="surrender-countdown"
              data-testid="surrender-countdown"
              data-countdown={String(surrenderSeconds)}
              aria-hidden="true"
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}
