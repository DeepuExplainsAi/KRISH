import type { ChipState } from "@krish/core";
import { IconCheck, IconClose, IconWarn } from "./icons";

const ICON: Record<ChipState, React.JSX.Element> = {
  running: <span className="dots" aria-hidden="true"><i /><i /><i /></span>,
  done: <IconCheck />,
  error: <IconClose size={16} />,
  action_required: <IconWarn />,
};

/** One step of the agent: spinner while running, check when done, warning when the user must act. */
export function ChipPill({ label, state, latest, onClick }: { label: string; state: ChipState; latest?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`chip ${state}${latest ? " latest" : ""}`} onClick={onClick}>
      {ICON[state]}
      <span className="txt">{label}</span>
    </button>
  );
}
