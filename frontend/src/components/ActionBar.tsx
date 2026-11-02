export interface ActionBarProps {
  legalActions: string[];
  onAction: (action: { type: string }) => void;
  /** Seconds left before the automatic surrender, shown on the Surrender button. */
  surrenderSeconds?: number | null;
  /** Seconds left before the automatic pass, shown on the Pass button. */
  passCountdownSeconds?: number | null;
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
}: ActionBarProps) {
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
          onClick={() => onAction({ type: button.type })}
        >
          {button.label}
          {button.action === 'pass' && passCountdownActive ? (
            <span class="surrender-countdown" data-testid="pass-countdown">
              {passCountdownSeconds}
            </span>
          ) : null}
          {button.action === 'surrender' && surrenderSeconds != null ? (
            <span class="surrender-countdown" data-testid="surrender-countdown">
              {surrenderSeconds}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
