import { DEFAULTS, searchModels, sortModels, type ProviderConfig } from "@krish/core";
import { useMemo, useState } from "react";
import { IconCheck, IconChevron, IconKey } from "../components/icons";
import { useT } from "../i18n/useT";
import { useApp, useAppState } from "../state/useStore";

type Preset = (typeof DEFAULTS.presets)[number];

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

/** Models that appeared or were retired at the last list refresh (at most a few names each). */
function Changes({ p }: { p: ProviderConfig }) {
  const { t } = useT();
  const c = p.modelsChanged;
  if (!c || (!c.added.length && !c.removed.length)) return null;
  const list = (ids: string[]) => ids.slice(0, 4).join(", ") + (ids.length > 4 ? ` +${ids.length - 4}` : "");
  return (
    <p className="muted small">
      {c.added.length > 0 && t("modelsNew", { list: list(c.added) })}
      {c.added.length > 0 && c.removed.length > 0 && " · "}
      {c.removed.length > 0 && t("modelsGone", { list: list(c.removed) })}
    </p>
  );
}

/** A colored dot and one short line: checking, ready, or the reason it is not working. */
function Health({ p }: { p: ProviderConfig }) {
  const s = useAppState();
  const { t } = useT();
  const checking = s.checking.includes(p.id);
  const state = checking ? "wait" : !p.health ? "idle" : p.health.ok ? "ok" : "bad";
  const text = checking ? t("checking") : !p.health ? t("notChecked") : p.health.ok ? t("connected") : p.health.note ?? t("notWorking", { why: "?" });
  return <span className={`health ${state}`} role="status"><i aria-hidden="true" />{text}</span>;
}

/** One connection in the order of use. `rank` = place among enabled ones (0 = tried first). */
function ProviderCard({ p, index, rank, last }: { p: ProviderConfig; index: number; rank: number; last: boolean }) {
  const app = useApp();
  const s = useAppState();
  const { t } = useT();
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<number>();
  const update = (patch: Partial<ProviderConfig>) => void app.updateProvider({ ...p, ...patch });
  const count = p.models?.items.length ?? 0;
  const busy = s.checking.includes(p.id);
  return (
    <div className="card pcard">
      <div className="row between">
        <span className="row">
          <span className="rank">{p.enabled ? rank + 1 : "–"}</span>
          <span className="stack"><strong>{p.name}</strong><Health p={p} /></span>
        </span>
        <label className="switch" title={t("enabled")}><input type="checkbox" checked={p.enabled} onChange={(e) => update({ enabled: e.target.checked })} aria-label={t("enabled")} /><i /></label>
      </div>
      <p className="muted">
        {count > 0 ? t("modelsLoaded", { count: String(count) }) : t("noModelsYet")}
        {p.models && ` · ${t("listFrom", { time: new Date(p.models.fetchedAt).toLocaleDateString() })}`}
        {" · "}{p.modelsChosen ? t("modelsManual") : t("modelsAuto")}
      </p>
      <Changes p={p} />
      {p.modelsError && <p className="error small">{p.modelsError}</p>}
      <div className="row">
        <button onClick={() => void app.testProvider(p.id)} disabled={busy}>{t("testConnection")}</button>
        <button onClick={() => void app.refreshProviderModels(p.id)} disabled={busy}>{t("refreshModels")}</button>
        <button onClick={() => setOpen(!open)} aria-expanded={open}>{open ? t("hide") : t("pickModels")}</button>
        <span className="grow" />
        <button disabled={index === 0} onClick={() => void app.moveProvider(p.id, -1)} aria-label={t("moveUp")} title={t("moveUp")}>↑</button>
        <button disabled={last} onClick={() => void app.moveProvider(p.id, 1)} aria-label={t("moveDown")} title={t("moveDown")}>↓</button>
      </div>
      {open && (
        <>
          {p.modelsChosen && <button className="ghost" onClick={() => void app.autoModels(p.id)}>{t("modelsBackToAuto")}</button>}
          <ModelPicker p={p} />
        </>
      )}
      <details className="more">
        <summary>{t("moreOptions")}</summary>
        <label><input type="checkbox" checked={p.allowSensitive} onChange={(e) => update({ allowSensitive: e.target.checked })} /> {t("allowSensitive")}</label>
        <label>{t("dailyCap")}
          <input type="number" min={1} value={p.dailyLimit ?? ""} onChange={(e) => update({ dailyLimit: e.target.value ? Number(e.target.value) : undefined })} />
        </label>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void app.setProviderKey(p.id, key).then(() => (setKey(""), app.testProvider(p.id))); }}>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t("replaceKey")} />
          <button type="submit" disabled={!key}>{t("saveKey")}</button>
        </form>
        <div className="row">
          <button onClick={() => void app.router.usageToday(p.id).then(setUsage)}>{usage === undefined ? t("usageToday") : t("usageCount", { count: String(usage) })}</button>
          <button className="danger" onClick={() => void app.removeProvider(p.id)}>{t("remove")}</button>
        </div>
      </details>
    </div>
  );
}

/** The key-free service that answers when nothing else can. Always the last in the order. */
function FreeAiCard() {
  const app = useApp();
  const on = useAppState().settings.freeFallback;
  const zen = useAppState().freeProviders.find((p) => p.id === "builtin-zen");
  const { t } = useT();
  return (
    <div className="card pcard builtin">
      <div className="row between">
        <span className="row"><span className="letter">∞</span><span className="stack"><strong>{t("freeAiTitle")}</strong><span className="muted">{t("freeAiNote")}</span></span></span>
        <label className="switch" title={t("enabled")}><input type="checkbox" checked={on} onChange={(e) => void app.saveSettings({ freeFallback: e.target.checked })} aria-label={t("freeAiTitle")} /><i /></label>
      </div>
      {zen && <Changes p={zen} />}
    </div>
  );
}

/** A catalog entry: tap to open, get a key on the provider's own page, paste it, done. The model list loads and is tested by itself. */
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
    void app.addProvider(base, key.trim()).then(() => (setKey(""), setOpen(false))).finally(() => setBusy(false));
  };
  return (
    <div className="card">
      <button className="row between plain" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="row">
          <span className="letter">{preset.name[0]}</span>
          <span className="stack"><strong>{preset.name}</strong><span className="muted">{preset.free}</span></span>
        </span>
        {added ? <span className="badge free"><IconCheck /> {t("providerAdded")}</span> : <IconChevron />}
      </button>
      {open && (
        <form className="steps" onSubmit={submit}>
          <p className="muted"><b>1</b> {t("step1")}</p>
          <button type="button" onClick={() => void app.platform.system.openExternal(preset.keyUrl)}><IconKey /> {t("getKey")}</button>
          <p className="muted"><b>2</b> {t("step2")}</p>
          <input type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder={t("apiKey")} value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="primary" type="submit" disabled={!key.trim() || busy}>{busy ? t("checking") : t("addAndLoad")}</button>
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
    void app.addProvider({ name: custom.name || "Custom", kind: "openai-compat", baseUrl: custom.baseUrl }, key.trim()).then(() => (setKey(""), setCustom({ name: "", baseUrl: "" })));
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
  const names = new Set(s.providers.map((p) => p.name));
  const working = s.providers.filter((p) => p.enabled && p.health?.ok).length;
  const free = DEFAULTS.presets.filter((p) => p.free);
  return (
    <section className="providers">
      <h2>{t("providers")}</h2>
      <div className="card summary">
        <strong>{t("keysSummary", { count: String(working) })}</strong>
        <p className="muted">{t("providersIntro")}</p>
      </div>

      <h3>{t("fallbackOrder")}</h3>
      {s.providers.length === 0 && <p className="muted">{t("noProvidersYet")}</p>}
      <div className="grid wide">
        {s.providers.map((p, i) => <ProviderCard key={p.id} p={p} index={i} rank={s.providers.slice(0, i).filter((x) => x.enabled).length} last={i === s.providers.length - 1} />)}
        <FreeAiCard />
      </div>

      <h3>{t("addKey")}</h3>
      <div className="grid wide">{free.map((p) => <CatalogRow key={p.name} preset={p} added={names.has(p.name)} />)}</div>
      <details className="more">
        <summary>{t("otherPreset")}</summary>
        <CustomForm />
      </details>
    </section>
  );
}
