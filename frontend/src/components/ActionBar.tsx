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
  variant: 'green' | 'red';
}

const BUTTONS: ActionButton[] = [
  { action: 'pass', type: 'passTurn', label: 'Pass', variant: 'green' },
  { action: 'surrender', type: 'declareSurrender', label: 'Surrender', variant: 'red' },
];

/**
 * Minimalist contextual bout controls: `Pass` for attackers waiting on
 * throw-ins, `Surrender` for a defender facing uncovered cards. Only actions the
 * server lists as legal are rendered.
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
          class={`action-button ${button.variant}`}
          data-testid={`${button.action}-button`}
          onClick={() => onAction({ type: button.type })}
        >
          <span class="action-label">{button.label}</span>
          {button.action === 'pass' && passCountdownActive ? (
            <span class="surrender-countdown" data-testid="pass-countdown" aria-hidden="true">
              {passCountdownSeconds}
            </span>
          ) : null}
          {button.action === 'surrender' && surrenderSeconds != null && surrenderSeconds > 0 ? (
            <span
              class="surrender-countdown"
              data-testid="surrender-countdown"
              aria-hidden="true"
            >
              {surrenderSeconds}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
