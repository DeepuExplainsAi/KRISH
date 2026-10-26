import { useEffect, useState } from "react";
import { Chat } from "./screens/Chat";
import { History } from "./screens/History";
import { Home } from "./screens/Home";
import { Menu, MENU_GROUPS } from "./screens/Menu";
import { Panels } from "./screens/Panels";
import { Projects } from "./screens/Projects";
import { Providers } from "./screens/Providers";
import { Security } from "./screens/Security";
import { Settings } from "./screens/Settings";
import { Tasks } from "./screens/Tasks";
import { Vault } from "./screens/Vault";
import { LiveWindow } from "./components/LiveWindow";
import { IconBack, IconPlus, IconStop } from "./components/icons";
import { useT } from "./i18n/useT";
import type { Key } from "./i18n";
import type { Screen } from "./state/store";
import { resolveTheme } from "./theme";
import { useApp, useAppState } from "./state/useStore";

/** Main tabs. Every other screen is reached from the Menu (avatar button). */
const TABS: [Screen, Key][] = [["home", "home"], ["chat", "chat"], ["projects", "projects"]];
const SUB = new Set<Screen>(["vault", "panels", "tasks", "history", "providers", "settings", "security"]);

const SCREENS: Record<Screen, () => React.JSX.Element> = {
  home: Home, chat: Chat, menu: Menu, panels: Panels, projects: Projects, tasks: Tasks,
  history: History, providers: Providers, settings: Settings, security: Security, vault: Vault,
};

const STATUS_KEY = { idle: "statusIdle", running: "statusWorking", action_required: "actionRequired", paused: "statusPaused" } as const;

export function App() {
  const app = useApp();
  const s = useAppState();
  const { t, lang } = useT();
  const [chatKey, setChatKey] = useState(0); // remounts Chat so an unsent draft does not follow into the new chat
  useEffect(() => () => app.dispose(), [app]);
  useEffect(() => void (document.documentElement.lang = lang), [lang]);
  const themePref = s.settings.theme;
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => void (document.documentElement.dataset.theme = resolveTheme(themePref, mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [themePref]);
  if (!s.ready) return <div className="boot">{t("starting")}</div>;
  const Screen = SCREENS[s.screen];
  return (
    <div className={`app${s.settings.liteMode ? " lite" : ""}`}>
      <header className="topbar">
        <button className="round" aria-label={t("newChat")} title={t("newChat")} disabled={s.running} onClick={() => { app.newChat(); setChatKey((k) => k + 1); }}><IconPlus /></button>
        <nav className="seg">
          {TABS.map(([id, key]) => (
            <button key={id} className={s.screen === id ? "on" : ""} onClick={() => app.go(id)}>{t(key)}</button>
          ))}
        </nav>
        <button className="avatar" aria-label={t("menu")} title={t("menu")} onClick={() => app.go("menu")}>K</button>
      </header>
      {s.status !== "idle" && (
        <div className="statusbar">
          <button className={`pill ${s.status}`} onClick={() => (s.running ? app.openWindow() : app.go("chat"))}>{t(STATUS_KEY[s.status])}</button>
          {s.running && <button className="stop" onClick={app.stop}><IconStop />{t("stop")}</button>}
        </div>
      )}
      {s.notice && <div className="notice glass" onClick={() => app.notify(undefined)}>{s.notice}</div>}
      <div className="body">
      <aside className="side" aria-label={t("menu")}>
        {MENU_GROUPS.flat().map(([screen, label, Icon]) => (
          <button key={screen} className={s.screen === screen ? "on" : ""} onClick={() => app.go(screen)}><Icon />{t(label)}</button>
        ))}
      </aside>
      <main>
        {SUB.has(s.screen) && <button className="back" onClick={() => app.go("menu")}><IconBack />{t("menu")}</button>}
        <Screen key={s.screen === "chat" ? `chat${chatKey}` : s.screen} />
      </main>
      </div>
      {s.screen !== "chat" && <LiveWindow />}
    </div>
  );
}
