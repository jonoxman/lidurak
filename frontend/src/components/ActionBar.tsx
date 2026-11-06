import '../styles/actionIcons.css';
import { PassIcon } from './icons/PassIcon';
import { SurrenderIcon } from './icons/SurrenderIcon';

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

export interface ActionButton {
  action: string;
  type: string;
  label: string;
  testId: string;
}

/**
 * T-90-feedback-20261106_111512-2: exactly the two contextual controls. The
 * former "Throw In" button is gone — cards are thrown in by dragging them onto
 * the throw-in outline or by double-clicking them.
 */
export const ACTION_BUTTONS: readonly ActionButton[] = [
  {
    action: 'pass',
    type: 'passTurn',
    label: 'Pass — done throwing in',
    testId: 'pass-button',
  },
  {
    action: 'surrender',
    type: 'declareSurrender',
    label: 'Surrender — take the cards',
    testId: 'surrender-button',
  },
];

/**
 * Minimalist contextual bout controls: the Pass glyph for attackers waiting on
 * throw-ins, the Surrender glyph for a defender facing uncovered cards. Only
 * actions the server lists as legal are rendered, and both are compact,
 * theme-matched, icon-only squares in the table's bottom-right corner.
 */
export function ActionBar({
  legalActions,
  onAction,
  surrenderSeconds = null,
  passCountdownSeconds = null,
  isBotSeat = false,
}: ActionBarProps) {
  // A bot seat takes no user input, so neither Surrender nor Pass appears.
  if (isBotSeat) return null;

  const buttons = ACTION_BUTTONS.filter((button) => legalActions.includes(button.action));
  const passCountdownActive = passCountdownSeconds != null && passCountdownSeconds > 0;

  if (buttons.length === 0) return null;

  return (
    <div class="action-bar">
      {buttons.map((button) => (
        <button
          key={button.action}
          type="button"
          class={`action-button action-icon-btn action-icon-${button.action}`}
          data-testid={button.testId}
          aria-label={button.label}
          title={button.label}
          onClick={() => onAction({ type: button.type })}
        >
          {button.action === 'pass' ? <PassIcon /> : <SurrenderIcon />}
          {/* The number is painted from `data-countdown` by CSS, so the
              icon-only button's textContent stays empty while a countdown runs. */}
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
