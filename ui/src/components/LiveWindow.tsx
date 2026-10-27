import { useEffect, useRef } from "react";
import { useT } from "../i18n/useT";
import { lastChip } from "../state/store";
import { useApp, useAppState } from "../state/useStore";
import { IconClose, IconExpand, IconShrink, IconWarn } from "./icons";

/** Smaller than this the page is not usable: the native view is hidden instead of squeezed. */
const MIN_VIEW = 40;
/** The page sits inside the black card with this margin and radius (keep in sync with `.live .view` in styles.css). */
const VIEW_RADIUS = 20;

const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
};

/**
 * The browser card: a black rounded card docked in the layout (above the composer in Chat, at the bottom elsewhere), the
 * same on phone, desktop window and Linux. The real browser view is a native view placed exactly over `.view`; the
 * status pill and buttons sit in the strip below it, because native pixels always cover app UI.
 */
export function LiveWindow({ compact = false }: { compact?: boolean }) {
  const app = useApp();
  const s = useAppState();
  const { t } = useT();
  const viewBox = useRef<HTMLDivElement>(null);
  const sent = useRef("");

  // While a confirm / question / secure card is up, the page area folds away so nothing page-controlled sits next to it.
  // Take-over prompts are the exception: the user needs the page to solve a CAPTCHA.
  const blocking = s.prompts.some((p) => p.type !== "takeover");
  const open = s.windowOpen;
  const expanded = s.windowExpanded;
  // On other screens (API Keys, Settings...) the window is only a status strip, so it never covers what the user came to see; Expand opens it full screen.
  const strip = compact && !expanded;
  const folded = blocking || strip;
  const show = open && !folded;

  // Sends the exact `.view` box to the native view, only when it changed. Runs after every render (the card moves when the
  // tray or keyboard changes the layout) and on resize.
  useEffect(() => {
    if (!show) {
      // Only talk to the native side when something changed (this effect runs after every render).
      if (sent.current !== "hidden") void app.platform.browser.setMode("hidden");
      sent.current = "hidden";
      return;
    }
    // The native view is a separate layer, so it must follow the card at every frame: the thread grows, the keyboard moves
    // things, the card animates in. Measuring once left it stranded in the wrong place and size, over other screens.
    let frame = 0;
    const sync = () => {
      const r = viewBox.current?.getBoundingClientRect();
      if (!r || r.width < MIN_VIEW || r.height < MIN_VIEW) {
        if (sent.current !== "hidden") void app.platform.browser.setMode("hidden");
        sent.current = "hidden";
      } else {
        const key = [r.left, r.top, r.width, r.height, expanded ? 1 : 0].map(Math.round).join(",");
        if (key !== sent.current) {
          sent.current = key;
          void app.platform.browser.setBounds({ x: r.left, y: r.top, width: r.width, height: r.height, radius: expanded ? 0 : VIEW_RADIUS });
          void app.platform.browser.setMode("live");
        }
      }
      frame = requestAnimationFrame(sync);
    };
    sync();
    return () => cancelAnimationFrame(frame);
  });

  if (!open) return null;

  const step = lastChip(s.items)?.chip;
  const needsYou = s.running && (s.status === "action_required" || step?.state === "action_required"); // a finished or stopped run never keeps the warning
  const hasPage = s.page.url !== "";
  const host = hostOf(s.page.url);
  const statusText = s.page.loading ? t("opening", { site: host || "…" }) : s.running && step ? step.label : s.page.title || host || t("winTitle");
  return (
    <div className={`live${expanded ? " full" : ""}${folded ? " folded" : ""}`} role="region" aria-label={t("winTitle")}>
      {!folded && (
        <div className="view" ref={viewBox}>
          {!hasPage && (
            <div className="view-empty">
              {(s.running || s.page.loading) && <span className="mark" aria-hidden="true" />}
              <p>{s.running ? t("opening", { site: "…" }) : t("noPage")}</p>
            </div>
          )}
        </div>
      )}
      <div className="live-foot">
        <span className={`status${needsYou ? " need" : ""}`}>
          {needsYou ? <IconWarn /> : (s.running || s.page.loading) && <span className="dots" aria-hidden="true"><i /><i /><i /></span>}
          <span className="txt">{needsYou ? t("actionRequired") : statusText}</span>
        </span>
        {s.running && !s.paused && <button className="round wide takeover" onClick={() => app.takeOver()}>{t("takeOver")}</button>}
        {s.paused && <button className="round wide" onClick={() => app.resume()}>{t("resume")}</button>}
        {s.running && <button className="round" onClick={app.stop} aria-label={t("stop")} title={t("stop")}><IconClose size={18} /></button>}
        <button className="round" onClick={app.toggleWindowExpanded} aria-label={expanded ? t("collapse") : t("expand")} title={expanded ? t("collapse") : t("expand")}>
          {expanded ? <IconShrink /> : <IconExpand />}
        </button>
        <button className="round" onClick={app.closeWindow} aria-label={t("close")} title={t("close")}><IconClose size={18} /></button>
      </div>
    </div>
  );
}
