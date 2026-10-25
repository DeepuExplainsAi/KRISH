import { DEFAULTS, searchModels, type ProviderConfig } from "@krish/core";
import { useState } from "react";
import { useApp, useAppState } from "../state/useStore";

function ModelPicker({ p }: { p: ProviderConfig }) {
  const app = useApp();
  const [q, setQ] = useState("");
  const items = searchModels(p.models?.items ?? [], q).slice(0, 60);
  return (
    <div className="models">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${p.models?.items.length ?? 0} models`} />
      <ul className="list scroll">
        {items.map((m) => (
          <li key={m.id}>
            <span>{m.id}{m.free ? " · free" : ""}</span>
            <span className="row">
              <button className={p.defaultModel === m.id ? "on" : ""} onClick={() => void app.updateProvider({ ...p, defaultModel: m.id })}>Default</button>
              <button className={p.fallbackModel === m.id ? "on" : ""} onClick={() => void app.updateProvider({ ...p, fallbackModel: m.id })}>Fallback</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProviderCard({ p, first, last }: { p: ProviderConfig; first: boolean; last: boolean }) {
  const app = useApp();
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<number>();
  const update = (patch: Partial<ProviderConfig>) => void app.updateProvider({ ...p, ...patch });
  return (
    <div className="card">
      <div className="row between">
        <strong>{p.name}</strong>
        <span className="row">
          <button disabled={first} onClick={() => void app.moveProvider(p.id, -1)} aria-label="Move up">↑</button>
          <button disabled={last} onClick={() => void app.moveProvider(p.id, 1)} aria-label="Move down">↓</button>
          <button onClick={() => void app.removeProvider(p.id)}>Remove</button>
        </span>
      </div>
      <label><input type="checkbox" checked={p.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Enabled</label>
      <label><input type="checkbox" checked={p.allowSensitive} onChange={(e) => update({ allowSensitive: e.target.checked })} /> Allow on sensitive pages</label>
      <label>Daily request cap (optional)
        <input type="number" min={1} value={p.dailyLimit ?? ""} onChange={(e) => update({ dailyLimit: e.target.value ? Number(e.target.value) : undefined })} />
      </label>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void app.setProviderKey(p.id, key).then(() => setKey("")); }}>
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Replace API key" />
        <button type="submit" disabled={!key}>Save key</button>
      </form>
      <div className="row">
        <button onClick={() => void app.refreshProviderModels(p.id)}>Refresh models</button>
        <button onClick={() => setOpen(!open)}>{open ? "Hide" : "Pick models"}</button>
        <button onClick={() => void app.router.usageToday(p.id).then(setUsage)}>{usage === undefined ? "Usage today" : `${usage} today`}</button>
      </div>
      <p className="muted">
        Default: {p.defaultModel ?? "none"} · Fallback: {p.fallbackModel ?? "none"}
        {p.models && ` · list from ${new Date(p.models.fetchedAt).toLocaleString()}`}
      </p>
      {p.modelsError && <p className="error">{p.modelsError}</p>}
      {open && <ModelPicker p={p} />}
    </div>
  );
}

export function Providers() {
  const app = useApp();
  const s = useAppState();
  const [preset, setPreset] = useState(0);
  const [custom, setCustom] = useState({ name: "", baseUrl: "" });
  const [key, setKey] = useState("");
  const chosen = DEFAULTS.presets[preset];
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const base = preset < 0 || !chosen
      ? { name: custom.name || "Custom", kind: "openai-compat" as const, baseUrl: custom.baseUrl }
      : { name: chosen.name, kind: chosen.kind, baseUrl: chosen.baseUrl, ...("modelsUrl" in chosen ? { modelsUrl: chosen.modelsUrl } : {}) };
    if (!base.baseUrl.startsWith("https://")) return app.notify("Provider URL must start with https://");
    void app.addProvider(base, key).then(() => setKey(""));
  };
  return (
    <section>
      <h2>Providers</h2>
      <p className="muted">Tried top to bottom. If one is rate-limited or down, the next one takes over. Keys stay in secure device storage.</p>
      {s.providers.map((p, i) => <ProviderCard key={p.id} p={p} first={i === 0} last={i === s.providers.length - 1} />)}
      <form className="card" onSubmit={add}>
        <h4>Add provider</h4>
        <select value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
          {DEFAULTS.presets.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
          <option value={-1}>Other (OpenAI-compatible)</option>
        </select>
        {preset < 0 && (
          <>
            <input placeholder="Name" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
            <input placeholder="Base URL, e.g. https://host/v1" value={custom.baseUrl} onChange={(e) => setCustom({ ...custom, baseUrl: e.target.value })} />
          </>
        )}
        <input type="password" autoComplete="off" placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="primary" type="submit" disabled={!key}>Add and load models</button>
      </form>
    </section>
  );
}
