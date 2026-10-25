import { useEffect } from "react";
import { Chat } from "./screens/Chat";
import { History } from "./screens/History";
import { Home } from "./screens/Home";
import { Panels } from "./screens/Panels";
import { Projects } from "./screens/Projects";
import { Providers } from "./screens/Providers";
import { Security } from "./screens/Security";
import { Settings } from "./screens/Settings";
import { Tasks } from "./screens/Tasks";
import { LiveWindow } from "./components/LiveWindow";
import type { Screen } from "./state/store";
import { useApp, useAppState } from "./state/useStore";

const NAV: [Screen, string][] = [
  ["home", "Home"], ["chat", "Chat"], ["panels", "Panels"], ["projects", "Projects"], ["tasks", "Tasks"],
  ["history", "History"], ["providers", "Providers"], ["settings", "Settings"], ["security", "Security"],
];

const SCREENS: Record<Screen, () => React.JSX.Element> = {
  home: Home, chat: Chat, panels: Panels, projects: Projects, tasks: Tasks,
  history: History, providers: Providers, settings: Settings, security: Security,
};

export function App() {
  const app = useApp();
  const s = useAppState();
  useEffect(() => () => app.dispose(), [app]);
  if (!s.ready) return <div className="boot">Starting…</div>;
  const Screen = SCREENS[s.screen];
  return (
    <div className={s.settings.liteMode ? "app lite" : "app"}>
      <header>
        <strong>Krish</strong>
        <button className={`pill ${s.status}`} onClick={() => (s.running ? app.openWindow() : app.go("chat"))}>
          {{ idle: "Idle", running: "Working", action_required: "Action required", paused: "Paused" }[s.status]}
        </button>
        {s.running && <button className="stop" onClick={app.stop}>STOP</button>}
      </header>
      {s.notice && <div className="notice" onClick={() => app.notify(undefined)}>{s.notice}</div>}
      <main><Screen /></main>
      <nav>
        {NAV.map(([id, label]) => (
          <button key={id} className={s.screen === id ? "on" : ""} onClick={() => app.go(id)}>{label}</button>
        ))}
      </nav>
      <LiveWindow />
    </div>
  );
}
