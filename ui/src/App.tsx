import { lazy, Suspense, useEffect, useState } from "react";
import { Chat } from "./screens/Chat";
import { Home } from "./screens/Home";
import { Menu, MENU_GROUPS } from "./screens/Menu";
import { LiveWindow } from "./components/LiveWindow";
import { Tour } from "./components/Tour";
import { IconBack, IconPlus, IconStop } from "./components/icons";
import { useT } from "./i18n/useT";
import type { Key } from "./i18n";
import type { Screen } from "./state/store";
import { resolveTheme } from "./theme";
import { useApp, useAppSelector } from "./state/useStore";

/** Main tabs. Every other screen is reached from the Menu (avatar button). */
const TABS: [Screen, Key][] = [["home", "home"], ["chat", "chat"], ["projects", "projects"]];
const SUB = new Set<Screen>(["vault", "panels", "tasks", "history", "providers", "settings", "security"]);

/** Home and Chat load with the app; every other screen is its own small file, fetched (from the device) when first opened. */
const screenOf = (load: () => Promise<Record<string, unknown>>, name: string) => lazy(() => load().then((m) => ({ default: m[name] as React.ComponentType })));
const SCREENS: Record<Screen, React.ComponentType> = {
  home: Home, chat: Chat, menu: Menu,
  panels: screenOf(() => import("./screens/Panels"), "Panels"),
  projects: screenOf(() => import("./screens/Projects"), "Projects"),
  tasks: screenOf(() => import("./screens/Tasks"), "Tasks"),
  history: screenOf(() => import("./screens/History"), "History"),
  providers: screenOf(() => import("./screens/Providers"), "Providers"),
  settings: screenOf(() => import("./screens/Settings"), "Settings"),
  security: screenOf(() => import("./screens/Security"), "Security"),
  vault: screenOf(() => import("./screens/Vault"), "Vault"),
};

const STATUS_KEY = { idle: "statusIdle", running: "statusWorking", action_required: "actionRequired", paused: "statusPaused" } as const;

export function App() {
  const app = useApp();
  // One subscription per field: page-load events and chat updates do not re-render the whole app.
  const ready = useAppSelector((x) => x.ready);
  const screen = useAppSelector((x) => x.screen);
  const running = useAppSelector((x) => x.running);
  const status = useAppSelector((x) => x.status);
  const notice = useAppSelector((x) => x.notice);
  const themePref = useAppSelector((x) => x.settings.theme);
  const lite = useAppSelector((x) => x.settings.liteMode);
  const { t, lang } = useT();
  const [chatKey, setChatKey] = useState(0); // remounts Chat so an unsent draft does not follow into the new chat
  useEffect(() => () => app.dispose(), [app]);
  useEffect(() => void (document.documentElement.lang = lang), [lang]);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => void (document.documentElement.dataset.theme = resolveTheme(themePref, mq.matches));
    apply();
    mq.addEventListener("change", apply);
    // Auto follows the clock: re-check every minute and when the app comes back to the front.
    const tick = setInterval(apply, 60_000);
    document.addEventListener("visibilitychange", apply);
    return () => {
      mq.removeEventListener("change", apply);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", apply);
    };
  }, [themePref]);
  if (!ready) return <div className="boot">Krish</div>;
  const Screen = SCREENS[screen];
  return (
    <div className={`app${lite ? " lite" : ""}`}>
      <header className="topbar">
        <button className="round" aria-label={t("newChat")} title={t("newChat")} disabled={running} onClick={() => { app.newChat(); setChatKey((k) => k + 1); }}><IconPlus /></button>
        <nav className="seg">
          {TABS.map(([id, key]) => (
            <button key={id} className={screen === id ? "on" : ""} onClick={() => app.go(id)}>{t(key)}</button>
          ))}
        </nav>
        <button className="avatar" aria-label={t("menu")} title={t("menu")} onClick={() => app.go("menu")}>K</button>
      </header>
      {status !== "idle" && (
        <div className="statusbar">
          <button className={`pill ${status}`} onClick={() => (running ? app.openWindow() : app.go("chat"))}>{t(STATUS_KEY[status])}</button>
          {running && <button className="stop" onClick={app.stop}><IconStop />{t("stop")}</button>}
        </div>
      )}
      <Tour />
      {notice && <div className="notice glass" onClick={() => app.notify(undefined)}>{notice}</div>}
      <div className="body">
      <aside className="side" aria-label={t("menu")}>
        {MENU_GROUPS.flat().map(([sc, label, Icon]) => (
          <button key={sc} className={screen === sc ? "on" : ""} onClick={() => app.go(sc)}><Icon />{t(label)}</button>
        ))}
      </aside>
      <main>
        {SUB.has(screen) && <button className="back" onClick={() => app.go("menu")}><IconBack />{t("menu")}</button>}
        <Suspense fallback={null}><Screen key={screen === "chat" ? `chat${chatKey}` : screen} /></Suspense>
      </main>
      </div>
      {screen !== "chat" && <LiveWindow />}
    </div>
  );
}
