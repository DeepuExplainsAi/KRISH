import { DEFAULTS, searchModels, sortModels, type ProviderConfig } from "@krish/core";
import { useMemo, useState } from "react";
import { useT } from "../i18n/useT";
import { useApp, useAppState } from "../state/useStore";

function ModelPicker({ p }: { p: ProviderConfig }) {
  const app = useApp();
  const { t } = useT();
  const [q, setQ] = useState("");
  const sorted = useMemo(() => sortModels(p.models?.items ?? []), [p.models]);
  const items = searchModels(sorted, q).slice(0, 60);
  return (
    <div className="models">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchModels", { count: String(p.models?.items.length ?? 0) })} />
      <ul className="list scroll">
        {items.map((m) => (
          <li key={m.id}>
            <span className="mname">{m.id}{m.free && <span className="badge free">{t("free")}</span>}</span>
            <span className="row">
              <button className={p.defaultModel === m.id ? "on" : ""} onClick={() => void app.updateProvider({ ...p, defaultModel: m.id, modelsChosen: true })}>{t("default")}</button>
              <button className={p.fallbackModel === m.id ? "on" : ""} onClick={() => void app.updateProvider({ ...p, fallbackModel: m.id, modelsChosen: true })}>{t("fallback")}</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Green tick = the last real call worked. Spinner while testing. Red note with the reason otherwise. */
function Status({ p }: { p: ProviderConfig }) {
  const s = useAppState();
  const { t } = useT();
  if (s.checking.includes(p.id)) return <span className="muted">{t("checking")}</span>;
  if (!p.health) return null;
  return p.health.ok
    ? <span className="tick" title={t("connected")} aria-label={t("connected")}>✓</span>
    : <span className="error small" role="status">{t("notWorking", { why: p.health.note ?? "?" })}</span>;
}

/** `rank` = position among enabled providers (0 = tried first); `index` = position in the full list. */
function ProviderCard({ p, index, rank, last }: { p: ProviderConfig; index: number; rank: number; last: boolean }) {
  const app = useApp();
  const s = useAppState();
  const { t } = useT();
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<number>();
  const update = (patch: Partial<ProviderConfig>) => void app.updateProvider({ ...p, ...patch });
  return (
    <div className="card">
      <div className="row between">
        <span className="row"><strong>{p.name}</strong><Status p={p} />{p.enabled && <span className="badge">{rank === 0 ? t("roleMain") : t("roleBackup", { n: String(rank) })}</span>}</span>
        <span className="row">
          <button disabled={index === 0} onClick={() => void app.moveProvider(p.id, -1)} aria-label={t("moveUp")} title={t("moveUp")}>↑</button>
          <button disabled={last} onClick={() => void app.moveProvider(p.id, 1)} aria-label={t("moveDown")} title={t("moveDown")}>↓</button>
          <button onClick={() => void app.removeProvider(p.id)}>{t("remove")}</button>
        </span>
      </div>
      <label><input type="checkbox" checked={p.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> {t("enabled")}</label>
      <details className="more">
        <summary>{t("settings")}</summary>
        <label><input type="checkbox" checked={p.allowSensitive} onChange={(e) => update({ allowSensitive: e.target.checked })} /> {t("allowSensitive")}</label>
        <label>{t("dailyCap")}
          <input type="number" min={1} value={p.dailyLimit ?? ""} onChange={(e) => update({ dailyLimit: e.target.value ? Number(e.target.value) : undefined })} />
        </label>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void app.setProviderKey(p.id, key).then(() => setKey("")); }}>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t("replaceKey")} />
          <button type="submit" disabled={!key}>{t("saveKey")}</button>
        </form>
        <button onClick={() => void app.router.usageToday(p.id).then(setUsage)}>{usage === undefined ? t("usageToday") : t("usageCount", { count: String(usage) })}</button>
      </details>
      <div className="row">
        <button onClick={() => void app.testProvider(p.id)} disabled={s.checking.includes(p.id)}>{t("testConnection")}</button>
        <button onClick={() => void app.refreshProviderModels(p.id)}>{t("refreshModels")}</button>
        <button onClick={() => setOpen(!open)}>{open ? t("hide") : t("pickModels")}</button>
      </div>
      <p className="muted">
        {t("defaultFallbackLine", { default: p.defaultModel ?? t("none"), fallback: p.fallbackModel ?? t("none") })}
        {p.models && ` · ${t("listFrom", { time: new Date(p.models.fetchedAt).toLocaleDateString() })}`}
      </p>
      {p.modelsError && <p className="error">{p.modelsError}</p>}
      {open && <ModelPicker p={p} />}
    </div>
  );
}

type Tab = "all" | "free" | "added" | "custom";
const TABS: Tab[] = ["all", "free", "added", "custom"];
type Preset = (typeof DEFAULTS.presets)[number];

/** One catalog row: tap to expand; "Get key" opens the provider's key page in the user's own browser, then the key goes in below. */
function CatalogRow({ preset, added }: { preset: Preset; added: boolean }) {
  const app = useApp();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const base = { name: preset.name, kind: preset.kind, baseUrl: preset.baseUrl, ...("modelsUrl" in preset ? { modelsUrl: preset.modelsUrl } : {}) };
    void app.addProvider(base, key).then(() => (setKey(""), setOpen(false))).finally(() => setBusy(false));
  };
  return (
    <div className="card">
      <button className="row between plain" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="row"><span className="letter">{preset.name[0]}</span><span><strong>{preset.name}</strong> <span className="muted">{added ? `· ${t("providerAdded")}` : ""}</span><br /><span className="muted">{preset.free}</span></span></span>
        {preset.free && <span className="badge">{t("free")}</span>}
      </button>
      {open && (
        <form onSubmit={submit}>
          <button type="button" className="primary" onClick={() => void app.platform.system.openExternal(preset.keyUrl)}>{t("getKey")}</button>
          <input type="password" autoComplete="off" placeholder={t("apiKey")} value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="primary" type="submit" disabled={!key || busy}>{t("addAndLoad")}</button>
        </form>
      )}
    </div>
  );
}

function CustomForm() {
  const app = useApp();
  const { t } = useT();
  const [custom, setCustom] = useState({ name: "", baseUrl: "" });
  const [key, setKey] = useState("");
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!custom.baseUrl.startsWith("https://")) return app.notify(t("providerHttps"));
    void app.addProvider({ name: custom.name || "Custom", kind: "openai-compat", baseUrl: custom.baseUrl }, key).then(() => (setKey(""), setCustom({ name: "", baseUrl: "" })));
  };
  return (
    <form className="card" onSubmit={add}>
      <h4>{t("otherPreset")}</h4>
      <input placeholder={t("name")} value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
      <input placeholder={t("baseUrlPlaceholder")} value={custom.baseUrl} inputMode="url" autoCapitalize="off" onChange={(e) => setCustom({ ...custom, baseUrl: e.target.value })} />
      <input type="password" autoComplete="off" placeholder={t("apiKey")} value={key} onChange={(e) => setKey(e.target.value)} />
      <button className="primary" type="submit" disabled={!key || !custom.baseUrl}>{t("addAndLoad")}</button>
    </form>
  );
}

export function Providers() {
  const s = useAppState();
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("all");
  const names = new Set(s.providers.map((p) => p.name));
  const catalog = DEFAULTS.presets.filter((p) => tab === "all" || (tab === "free" && p.free));
  return (
    <section className="providers">
      <h2>{t("providers")}</h2>
      <p className="muted">{t("providersIntro")}</p>
      {(tab === "added" || tab === "all") && s.providers.length > 0 && (
        <div className="grid wide">{s.providers.map((p, i) => <ProviderCard key={p.id} p={p} index={i} rank={s.providers.slice(0, i).filter((x) => x.enabled).length} last={i === s.providers.length - 1} />)}</div>
      )}
      {tab === "added" && s.providers.length === 0 && <p className="muted">{t("noProvidersYet")}</p>}
      {tab !== "added" && tab !== "custom" && <div className="grid wide">{catalog.map((p) => <CatalogRow key={p.name} preset={p} added={names.has(p.name)} />)}</div>}
      {(tab === "custom" || tab === "all") && <CustomForm />}
      <nav className="pills" aria-label={t("providers")}>
        {TABS.map((x) => <button key={x} className={tab === x ? "on" : ""} onClick={() => setTab(x)}>{t(`tab_${x}` as never)}</button>)}
      </nav>
    </section>
  );
}
