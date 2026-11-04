import { SOCIAL_PREFIXES, type LogEntry } from "@krish/core";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import type { LaunchableApp, PhoneStatus } from "../platform/types";
import { useApp } from "../state/useStore";

const isSocial = (pkg: string) => SOCIAL_PREFIXES.some((p) => pkg.startsWith(p));

/** Consent first. Nothing else on this screen works until the user accepted it. */
export function Phone() {
  const app = useApp();
  const { t } = useT();
  const phone = app.platform.phone;
  const [consent, setConsent] = useState<boolean>();
  useEffect(() => void app.consent.accepted().then(setConsent), [app]);
  if (!phone?.supported) return <section><h2>{t("phone")}</h2><p className="muted">{t("phoneUnsupported")}</p></section>;
  if (consent === undefined) return null;
  return consent ? <Controls onRevoke={() => void app.consent.revoke().then(() => setConsent(false))} /> : <Consent onAccept={() => void app.consent.accept().then(() => setConsent(true))} />;
}

function Consent({ onAccept }: { onAccept: () => void }) {
  const { t } = useT();
  const blocks = [["phoneSees", "phoneSeesBody"], ["phoneSends", "phoneSendsBody"], ["phoneAsks", "phoneAsksBody"], ["phoneStops", "phoneStopsBody"]] as const;
  return (
    <section>
      <h2>{t("phoneConsentTitle")}</h2>
      {blocks.map(([h, b]) => <div className="card" key={h}><strong>{t(h)}</strong><p>{t(b)}</p></div>)}
      <p className="muted">{t("phoneRisk")}</p>
      <details><summary>{t("privacyPolicy")}</summary><p>{t("privacyBody")}</p></details>
      <details><summary>{t("terms")}</summary><p>{t("termsBody")}</p></details>
      <button className="primary" onClick={onAccept}>{t("phoneAccept")}</button>
    </section>
  );
}

function Controls({ onRevoke }: { onRevoke: () => void }) {
  const app = useApp();
  const { t } = useT();
  const phone = app.platform.phone!;
  const [status, setStatus] = useState<PhoneStatus>();
  const [apps, setApps] = useState<LaunchableApp[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const reload = useCallback(() => {
    void phone.status().then(setStatus);
    void app.activity.list().then((l) => setLog(l.reverse()));
  }, [app, phone]);
  useEffect(() => {
    reload();
    void phone.launchableApps().then(setApps);
    const off = phone.onState(reload);
    window.addEventListener("focus", reload); // back from Android settings
    return () => { off(); window.removeEventListener("focus", reload); };
  }, [phone, reload]);

  const allowed = new Set(status?.allowlist ?? []);
  const toggle = (pkg: string) => {
    const next = new Set(allowed);
    if (!next.delete(pkg)) next.add(pkg);
    void phone.setAllowlist([...next]).then(reload);
  };

  return (
    <section>
      <h2>{t("phone")}</h2>
      <p className="muted">{t("phoneIntro")}</p>
      <p>{t("phoneState")}: <strong>{status?.state ?? "…"}</strong>{status?.reason ? ` (${status.reason})` : ""}</p>
      {status?.state !== "idle" && <button className="stop" onClick={() => void phone.stop("user_stop").then(reload)}>{t("stop")}</button>}

      <h3>{t("phoneSetup")}</h3>
      <ul className="list">
        <li><span>{t("phoneAccessibility")}: <strong>{status?.accessibility ? t("phoneOn") : t("phoneOff")}</strong><br /><small className="muted">{t("phoneAccessibilityHelp")}</small></span><button onClick={() => void phone.openAccessibilitySettings()}>{t("phoneOpenSettings")}</button></li>
        <li><span>{t("phoneBattery")}<br /><small className="muted">{t("phoneBatteryHelp")}</small></span><button onClick={() => void phone.openBatterySettings()}>{t("phoneOpenSettings")}</button></li>
      </ul>

      <h3>{t("phoneApps")}</h3>
      <p className="muted">{allowed.size ? t("phoneAppsHelp") : t("phoneNoApps")}</p>
      <ul className="list scroll">
        {apps.map((a) => (
          <li key={a.pkg} style={a.blocked ? { opacity: 0.45 } : undefined}>
            <label>
              <input type="checkbox" disabled={a.blocked} checked={allowed.has(a.pkg.toLowerCase())} onChange={() => toggle(a.pkg.toLowerCase())} /> {a.label}
              {a.blocked && <small> · {t("phoneBlocked")}</small>}
              {!a.blocked && isSocial(a.pkg) && <small> · ⚠</small>}
            </label>
          </li>
        ))}
      </ul>
      {[...allowed].some(isSocial) && <p className="muted">{t("phoneRisk")}</p>}

      <h3>{t("phoneLog")}</h3>
      {log.length === 0 ? <p className="muted">{t("phoneLogEmpty")}</p> : (
        <ul className="list scroll">
          {log.slice(0, 200).map((e) => <li key={e.id}><span><small>{new Date(e.at).toLocaleTimeString()} · {e.kind}</small><br />{e.text}</span></li>)}
        </ul>
      )}
      <button onClick={() => void app.activity.clear().then(reload)}>{t("phoneLogClear")}</button>
      <details><summary>{t("privacyPolicy")}</summary><p>{t("privacyBody")}</p></details>
      <details><summary>{t("terms")}</summary><p>{t("termsBody")}</p></details>
      <button onClick={onRevoke}>{t("phoneRevoke")}</button>
    </section>
  );
}
