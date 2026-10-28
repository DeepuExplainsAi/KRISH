import { ALL_SITES, type VaultEntry } from "@krish/core";
import { useState } from "react";
import { useT } from "../i18n/useT";
import { useApp } from "../state/useStore";
import { useAppState } from "../state/useStore";

const EMPTY = { site: "", label: "", username: "", password: "", note: "" };

function Entry({ e }: { e: VaultEntry }) {
  const app = useApp();
  const { t } = useT();
  const [show, setShow] = useState(false);
  return (
    <div className="card">
      <div className="row between">
        <strong>{e.label}</strong>
        <button onClick={() => void app.vault.remove(e.id)}>{t("delete")}</button>
      </div>
      <p className="muted">{e.site === ALL_SITES ? t("vaultAllSites") : e.site} · {e.username || "-"}</p>
      <div className="row">
        <input readOnly type={show ? "text" : "password"} value={e.password} aria-label={t("vaultPassword")} autoComplete="off" />
        <button onClick={() => setShow(!show)}>{show ? t("hide") : t("vaultShow")}</button>
      </div>
      {e.note && <pre>{e.note}</pre>}
    </div>
  );
}

/** KrishVault: saved logins, kept for good. Krish fills them in by itself; nothing to unlock. */
export function Vault() {
  const app = useApp();
  useAppState(); // re-render when the vault loads or changes
  const { t } = useT();
  const v = app.vault;
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const run = (job: Promise<unknown>) => { setBusy(true); return job.catch((e) => app.notify(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)); };

  if (!v.loaded) return <section><h2>{t("vault")}</h2></section>;
  if (v.unreadable) return <section><h2>{t("vault")}</h2><p className="error">{t("vaultUnreadable")}</p></section>;
  const list = v.list();
  return (
    <section>
      <h2>{t("vault")}</h2>
      <p className="muted">{t("vaultIntro")}</p>
      {list.length === 0 && <p className="muted">{t("vaultEmpty")}</p>}
      <div className="grid">{list.map((e) => <Entry key={e.id} e={e} />)}</div>
      <form className="card" onSubmit={(e) => { e.preventDefault(); void run(v.put(f).then(() => setF(EMPTY))); }}>
        <h4>{t("vaultAdd")}</h4>
        <label><input type="checkbox" checked={f.site === ALL_SITES} onChange={(e) => setF({ ...f, site: e.target.checked ? ALL_SITES : "" })} /> {t("vaultAllSites")}</label>
        {f.site !== ALL_SITES && <input placeholder={t("vaultSite")} value={f.site} inputMode="url" autoCapitalize="off" onChange={(e) => setF({ ...f, site: e.target.value })} />}
        <p className="muted">{t("vaultSiteHint")}</p>
        <input placeholder={t("vaultLabel")} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        <input placeholder={t("vaultUsername")} value={f.username} autoCapitalize="off" autoComplete="off" onChange={(e) => setF({ ...f, username: e.target.value })} />
        <input type="password" placeholder={t("vaultPassword")} value={f.password} autoComplete="new-password" onChange={(e) => setF({ ...f, password: e.target.value })} />
        <textarea placeholder={t("vaultNote")} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <button className="primary" type="submit" disabled={busy || !f.site.trim() || !f.password}>{t("save")}</button>
      </form>
    </section>
  );
}
