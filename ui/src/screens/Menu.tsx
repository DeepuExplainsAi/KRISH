import { IconChevron, IconClock, IconGear, IconHistory, IconKey, IconPanels, IconShield, IconVault } from "../components/icons";
import { useT } from "../i18n/useT";
import type { Key } from "../i18n";
import type { Screen } from "../state/store";
import { useApp, useAppSelector } from "../state/useStore";

/** Shared with the desktop sidebar so both show the same entries. */
export const MENU_GROUPS: [Screen, Key, () => React.JSX.Element][][] = [
  [["vault", "vault", IconVault], ["providers", "providers", IconKey], ["panels", "panels", IconPanels], ["tasks", "tasks", IconClock]],
  [["settings", "settings", IconGear], ["history", "history", IconHistory], ["security", "security", IconShield]],
];

/** Everything that is not a main tab lives here, so no screen or feature is lost. */
export function Menu() {
  const app = useApp();
  const showKeys = useAppSelector(() => app.onlineAllowed());
  const { t } = useT();
  return (
    <section className="menu">
      <h1 className="brand">Krish</h1>
      {MENU_GROUPS.map((group, i) => (
        <div className="glass group" key={i}>
          {group.filter(([screen]) => screen !== "providers" || showKeys).map(([screen, label, Icon]) => (
            <button key={screen} className="row-item" onClick={() => app.go(screen)}>
              <Icon />
              <span>{t(label)}</span>
              <IconChevron />
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}
