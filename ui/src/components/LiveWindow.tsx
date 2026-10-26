import { useEffect, useRef } from "react";
import { useT } from "../i18n/useT";
import type { Key } from "../i18n";
import { lastChip, WINDOW_PRESETS, type WindowSize } from "../state/store";
import { useApp, useAppState } from "../state/useStore";
import { IconClose, IconExpand, IconMinimize, IconShrink, IconWarn } from "./icons";

const SIZES: [WindowSize, string, Key][] = [["mini", "S", "winSmall"], ["medium", "M", "winMedium"], ["large", "L", "winLarge"], ["full", "XL", "expand"]];
/** One tap on the expand button grows the card; from full it drops back to medium. */
const NEXT: Record<WindowSize, WindowSize> = { mini: "medium", medium: "large", large: "full", full: "medium" };
const HEADER = 40;
const MIN_VIEW = 40;
/** Smallest card that still fits header + footer + a usable page area (manual resize and pinch). */
const MIN_W = 260;
const MIN_H = 170;

/**
 * Floating card over the chat. The real browser view is a native view positioned under the
 * transparent `.view` area; this component only owns the frame, handles and bounds.
 */
export function LiveWindow() {
  const app = useApp();
  const s = useAppState();
  const { t } = useT();
  const { size, x, y, w, h } = s.settings.window;
  const mini = size === "mini";
  const snapshotMode = mini && s.deviceLowRam;
  const frame = useRef<HTMLDivElement>(null);
  const viewBox = useRef<HTMLDivElement>(null);
  const pinch = useRef<{ d: number; w: number; h: number } | undefined>(undefined);
  const endGesture = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => endGesture.current?.(), []);

  // While a confirm / question / secure card is up, the live card collapses to its pill so nothing page-controlled can cover it.
  // Take-over prompts are the exception: the user needs the page to solve a CAPTCHA.
  const blocking = s.prompts.some((p) => p.type !== "takeover");
  const pill = s.windowMinimized || blocking;
  const open = s.windowOpen;

  // Native browser pixels sit above all app UI, so they must cover ONLY the .view box (never header, footer or prompts).
  useEffect(() => {
    const show = open && !pill && !snapshotMode;
    app.syncSnapshots(open && !pill && snapshotMode);
    if (!show) {
      void app.platform.browser.setMode("hidden");
      return;
    }
    // At most one native bounds call per frame while dragging or resizing.
    const frameId = requestAnimationFrame(() => {
      const r = viewBox.current?.getBoundingClientRect();
      // Exact `.view` box, never larger: native pixels sit above all UI. Too small to be useful -> hide it instead.
      if (r && r.width >= MIN_VIEW && r.height >= MIN_VIEW) {
        void app.platform.browser.setBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
        void app.platform.browser.setMode("live");
      } else void app.platform.browser.setMode("hidden");
    });
    return () => cancelAnimationFrame(frameId);
  }, [app, open, pill, snapshotMode, x, y, w, h]);

  if (!open) return null;
  if (pill) {
    return (
      <button className="live-pill" onClick={() => app.minimizeWindow(false)}>
        {s.page.title || s.page.url || t("winTitle")} ▲
      </button>
    );
  }

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  /** Runs a drag/resize: `move` updates the screen only; the end (up, cancel or unmount) removes listeners and saves once. */
  const gesture = (pointerId: number, move: (m: PointerEvent) => void) => {
    const onMove = (m: PointerEvent) => { if (m.pointerId === pointerId) move(m); };
    const end = (m?: PointerEvent) => {
      if (m && m.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      endGesture.current = undefined;
      void app.setWindowRect({});
    };
    endGesture.current?.();
    endGesture.current = end;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  const drag = (e: React.PointerEvent) => {
    if (size === "full") return;
    const sx = e.clientX - x, sy = e.clientY - y;
    gesture(e.pointerId, (m) =>
      void app.setWindowRect({ x: clamp(m.clientX - sx, -w + 60, window.innerWidth - 60), y: clamp(m.clientY - sy, 0, window.innerHeight - HEADER) }, false));
  };
  const resize = (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX - w, sy = e.clientY - h;
    gesture(e.pointerId, (m) =>
      void app.setWindowRect({ size: "medium", w: clamp(m.clientX - sx, MIN_W, window.innerWidth - x), h: clamp(m.clientY - sy, MIN_H, window.innerHeight - y) }, false));
  };
  // Two-finger pinch on the header/frame border resizes (the page itself gets its own touch input).
  const touchDist = (t: React.TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
  const onTouchStart = (e: React.TouchEvent) => { if (e.touches.length === 2) pinch.current = { d: touchDist(e.touches), w, h }; };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinch.current) return;
    const k = touchDist(e.touches) / pinch.current.d;
    const max = WINDOW_PRESETS.full(window.innerWidth, window.innerHeight);
    void app.setWindowRect({ size: "medium", w: clamp(pinch.current.w * k, MIN_W, max.w), h: clamp(pinch.current.h * k, MIN_H, max.h) }, false);
  };
  const onTouchEnd = () => { if (pinch.current) { pinch.current = undefined; void app.setWindowRect({}); } };

  const live = s.running || s.page.url !== "";
  const step = lastChip(s.items)?.chip;
  const needsYou = s.status === "action_required" || step?.state === "action_required";
  const statusText = s.page.loading ? t("loading") : s.running && step ? step.label : s.page.title || s.page.url || t("winTitle");
  return (
    <div ref={frame} className={`live ${size}`} style={{ left: x, top: y, width: w, height: h }} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <div className="live-head" onPointerDown={drag}>
        <button className="mini-btn" onPointerDown={(e) => e.stopPropagation()} onClick={app.closeWindow} aria-label={t("close")} title={t("close")}><IconClose size={16} /></button>
        <span className="title">{s.page.loading ? t("loading") : s.page.title || s.page.url || t("winTitle")}</span>
        {SIZES.map(([k, label, key]) => (
          <button key={k} className={`size ${size === k ? "on" : ""}`} aria-label={t(key)} title={t(key)} onPointerDown={(e) => e.stopPropagation()} onClick={() => void app.setWindowSize(k)}>{label}</button>
        ))}
        <button className="mini-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => app.minimizeWindow(true)} aria-label={t("minimize")} title={t("minimize")}><IconMinimize /></button>
      </div>
      <div className="view" ref={viewBox}>
        {snapshotMode && s.snapshot && <img src={s.snapshot} alt={t("snapshot")} />}
        {!live && <p className="muted">{t("noPage")}</p>}
      </div>
      <div className="live-foot">
        <span className={`status ${needsYou ? "need" : ""}`}>
          {needsYou ? <IconWarn /> : s.running && <span className="dots" aria-hidden="true"><i /><i /><i /></span>}
          <span className="txt">{needsYou ? t("actionRequired") : statusText}</span>
        </span>
        <button className="round dark" onClick={() => void app.setWindowSize(NEXT[size])} aria-label={size === "full" ? t("collapse") : t("expand")} title={size === "full" ? t("collapse") : t("expand")}>
          {size === "full" ? <IconShrink /> : <IconExpand />}
        </button>
        {s.running && !s.paused && <button className="round dark wide takeover" onClick={() => app.takeOver()}>{t("takeOver")}</button>}
        {s.paused && <button className="round dark wide" onClick={() => app.resume()}>{t("resume")}</button>}
        {s.running && <button className="round stop" onClick={app.stop} aria-label={t("stop")} title={t("stop")}><IconClose size={18} /></button>}
      </div>
      <div className="handle" onPointerDown={resize} aria-label={t("resize")} />
    </div>
  );
}
