import { useEffect, useRef } from "react";
import { WINDOW_PRESETS, type WindowSize } from "../state/store";
import { useApp, useAppState } from "../state/useStore";

const SIZES: [WindowSize, string][] = [["mini", "Mini"], ["medium", "Medium"], ["large", "Large"], ["full", "Full"]];
const HEADER = 34;

/**
 * Floating card over the chat. The real browser view is a native view positioned under the
 * transparent `.view` area; this component only owns the frame, handles and bounds.
 */
export function LiveWindow() {
  const app = useApp();
  const s = useAppState();
  const { size, x, y, w, h } = s.settings.window;
  const mini = size === "mini";
  const snapshotMode = mini && s.deviceLowRam;
  const frame = useRef<HTMLDivElement>(null);
  const viewBox = useRef<HTMLDivElement>(null);
  const pinch = useRef<{ d: number; w: number; h: number } | undefined>(undefined);

  // While a confirm / question / secure card is up, the live card collapses to its pill so nothing page-controlled can cover it.
  // Take-over prompts are the exception: the user needs the page to solve a CAPTCHA.
  const blocking = s.prompts.some((p) => p.type !== "takeover");
  const pill = s.windowMinimized || blocking;
  const open = s.windowOpen;

  // Native browser pixels sit above all app UI, so they must cover ONLY the .view box (never header, footer or prompts).
  useEffect(() => {
    const show = open && !pill && !snapshotMode;
    if (!show) {
      void app.platform.browser.setMode("hidden");
    } else {
      const r = viewBox.current?.getBoundingClientRect();
      if (r) void app.platform.browser.setBounds({ x: r.left, y: r.top, width: Math.max(40, r.width), height: Math.max(40, r.height) });
      void app.platform.browser.setMode("live");
    }
    app.syncSnapshots(open && !pill && snapshotMode);
  }, [app, open, pill, snapshotMode, x, y, w, h]);

  if (!open) return null;
  if (pill) {
    return (
      <button className="live-pill" onClick={() => app.minimizeWindow(false)}>
        {s.page.title || s.page.url || "Browser"} ▲
      </button>
    );
  }

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const drag = (e: React.PointerEvent) => {
    if (size === "full") return;
    const sx = e.clientX - x, sy = e.clientY - y;
    const move = (m: PointerEvent) =>
      void app.setWindowRect({ x: clamp(m.clientX - sx, -w + 60, window.innerWidth - 60), y: clamp(m.clientY - sy, 0, window.innerHeight - HEADER) });
    const up = () => (window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const resize = (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX - w, sy = e.clientY - h;
    const move = (m: PointerEvent) =>
      void app.setWindowRect({ size: "medium", w: clamp(m.clientX - sx, 140, window.innerWidth - x), h: clamp(m.clientY - sy, 100, window.innerHeight - y) });
    const up = () => (window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // Two-finger pinch on the header/frame border resizes (the page itself gets its own touch input).
  const touchDist = (t: React.TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
  const onTouchStart = (e: React.TouchEvent) => { if (e.touches.length === 2) pinch.current = { d: touchDist(e.touches), w, h }; };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinch.current) return;
    const k = touchDist(e.touches) / pinch.current.d;
    const max = WINDOW_PRESETS.full(window.innerWidth, window.innerHeight);
    void app.setWindowRect({ size: "medium", w: clamp(pinch.current.w * k, 140, max.w), h: clamp(pinch.current.h * k, 100, max.h) });
  };

  const live = s.running || s.page.url !== "";
  return (
    <div ref={frame} className={`live ${size}`} style={{ left: x, top: y, width: w, height: h }} onTouchStart={onTouchStart} onTouchMove={onTouchMove}>
      <div className="live-head" onPointerDown={drag}>
        <span className="title">{s.page.loading ? "Loading…" : s.page.title || s.page.url || "Browser"}</span>
        {SIZES.map(([k, label]) => (
          <button key={k} className={size === k ? "on" : ""} onPointerDown={(e) => e.stopPropagation()} onClick={() => void app.setWindowSize(k)}>{label}</button>
        ))}
        <button onPointerDown={(e) => e.stopPropagation()} onClick={() => app.minimizeWindow(true)} aria-label="Minimize">–</button>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={app.closeWindow} aria-label="Close">✕</button>
      </div>
      <div className="view" ref={viewBox}>
        {snapshotMode && s.snapshot && <img src={s.snapshot} alt="Browser snapshot" />}
        {!live && <p className="muted">No page yet. Ask the agent to open a site.</p>}
      </div>
      <div className="live-foot">
        {s.running && !s.paused && <button onClick={() => app.takeOver()}>Take over</button>}
        {s.paused && <button className="primary" onClick={() => app.resume()}>Resume</button>}
        {s.running && <button className="stop" onClick={app.stop}>STOP</button>}
      </div>
      <div className="handle" onPointerDown={resize} aria-label="Resize" />
    </div>
  );
}
