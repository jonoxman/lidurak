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
      aria-hidden="true"
      focusable="false"
    >
      <g data-icon-part="cards">
        <rect x="9.2" y="1.2" width="4.6" height="6.6" rx="1" transform="rotate(-14 11.5 4.5)" />
        <rect x="10.6" y="1.2" width="4.6" height="6.6" rx="1" transform="rotate(8 12.9 4.5)" />
      </g>
      <g data-icon-part="arrow-down">
        <path d="M12 8.4 V12.6" />
        <path d="M10.1 10.8 L12 12.7 L13.9 10.8" />
      </g>
      {/* Two raised open palms: an outlined palm with four fingers and a
          thumb per hand, so the gesture reads as surrender at 22px. */}
      <g data-icon-part="raised-hands">
        <path d="M2.7 18.5 v2.1 a1.7 1.7 0 0 0 1.7 1.7 h3.1 a1.7 1.7 0 0 0 1.7-1.7 v-2.1" />
        <path d="M3.8 18.4 v-4.1 M5.2 18.4 v-5.3 M6.6 18.4 v-4.7 M8 18.4 v-3.5" />
        <path d="M2.7 19.3 l-1.4 -1.1" />
        <path d="M14.8 18.5 v2.1 a1.7 1.7 0 0 0 1.7 1.7 h3.1 a1.7 1.7 0 0 0 1.7-1.7 v-2.1" />
        <path d="M16 18.4 v-3.5 M17.4 18.4 v-4.7 M18.8 18.4 v-5.3 M20.2 18.4 v-4.1" />
        <path d="M21.3 19.3 l1.4 -1.1" />
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
      aria-hidden="true"
      focusable="false"
    >
      <g data-icon-part="cards">
        <rect x="2.2" y="2" width="4.6" height="6.6" rx="1" transform="rotate(-12 4.5 5.3)" />
        <rect x="4.6" y="2" width="4.6" height="6.6" rx="1" transform="rotate(6 6.9 5.3)" />
      </g>
      {/* A waving open hand: outlined palm, four fingers and a thumb, tilted as
          if it is being waved past the cards. */}
      <g data-icon-part="pass-hand">
        <g transform="rotate(-20 8.7 16.4)">
          <path d="M5.2 18.9 v1.4 a1.5 1.5 0 0 0 1.5 1.5 h2.7 a1.5 1.5 0 0 0 1.5-1.5 v-1.4" />
          <path d="M6.1 18.8 v-3.3 M7.3 18.8 v-4.2 M8.5 18.8 v-3.7 M9.7 18.8 v-2.8" />
          <path d="M5.2 19.7 l-1.3 -1" />
        </g>
      </g>
      {/* The pass arrow sweeps up from the hand and arcs past the cards. */}
      <g data-icon-part="arrow-pass">
        <path d="M11.2 20.6 C18.6 19.4 21.4 10.4 16.4 5.2" />
        <path d="M13.9 6.3 L16.6 5.1 L17.2 8" />
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
