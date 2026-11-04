import { approvePlan, createPlan, describePlan, SOCIAL_PREFIXES, type LogEntry } from "@krish/core";
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

      <Session allowed={[...allowed]} reload={reload} />

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

/** Mode B (AI client through the relay) and starting a task: the user approves the plan here, on the phone. */
function Session({ allowed, reload }: { allowed: string[]; reload: () => void }) {
  const app = useApp();
  const { t } = useT();
  const svc = app.phoneService;
  const [relay, setRelay] = useState("");
  const [connector, setConnector] = useState("");
  const [task, setTask] = useState("");
  const [error, setError] = useState("");
  if (!svc) return null;
  const cur = svc.current;
  const plan = approvePlan(createPlan(task || "Use the connected AI", allowed));

  const enable = () => void svc.enableMcp(relay).then((r) => { setError(r.ok ? "" : r.reason); setConnector(r.ok ? r.connectorUrl : ""); reload(); });
  const start = () => void svc.begin(plan).then((r) => { setError(r.ok ? "" : r.reason); reload(); });

  return (
    <>
      <h3>{t("phoneModeB")}</h3>
      <p className="muted">{t("phoneModeBHelp")}</p>
      <input value={relay} onChange={(e) => setRelay(e.target.value)} placeholder="https://krish-relay.you.workers.dev" inputMode="url" autoCapitalize="off" />
      <div className="row">
        {cur.mode === "mcp" ? <button onClick={() => void svc.disable().then(() => { setConnector(""); reload(); })}>{t("phoneDisconnect")}</button> : <button className="primary" disabled={!relay} onClick={enable}>{t("phoneConnect")}</button>}
        {cur.mode === "mcp" && <button onClick={() => void svc.rotateToken(relay).then((r) => { setConnector(r.ok ? r.connectorUrl : ""); reload(); })}>{t("phoneRotate")}</button>}
      </div>
      {cur.mode === "mcp" && <p>{t("phoneRelay")}: <strong>{cur.relay}</strong></p>}
      {connector && (
        <>
          <p className="muted">{t("phoneConnectorHelp")}</p>
          <input readOnly value={connector} onFocus={(e) => e.target.select()} />
          <button onClick={() => void navigator.clipboard?.writeText(connector)}>{t("phoneCopy")}</button>
        </>
      )}
      {error && <p className="error">{error}</p>}

      <h3>{t("phonePlan")}</h3>
      <input value={task} onChange={(e) => setTask(e.target.value)} placeholder={t("phoneTaskPlaceholder")} />
      <ul className="list plain">{describePlan(plan).map((l) => <li key={l}>{l}</li>)}</ul>
      <button className="primary" disabled={cur.taskActive || allowed.length === 0} onClick={start}>{t("phoneApproveStart")}</button>
    </>
  );
}
