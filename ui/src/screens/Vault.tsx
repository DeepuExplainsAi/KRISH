import { MIN_PASSPHRASE, type VaultEntry } from "@krish/core";
import { useState } from "react";
import { IconLock } from "../components/icons";
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
      <p className="muted">{e.site} · {e.username || "-"}</p>
      <div className="row">
        <input readOnly type={show ? "text" : "password"} value={e.password} aria-label={t("vaultPassword")} autoComplete="off" />
        <button onClick={() => setShow(!show)}>{show ? t("hide") : t("vaultShow")}</button>
      </div>
      {e.note && <pre>{e.note}</pre>}
    </div>
  );
}

/** The unlocked view lives only while the vault is unlocked, so a half-typed login (password, notes) is dropped when it locks. */
function Unlocked() {
  const app = useApp();
  const { t } = useT();
  const v = app.vault;
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const run = (job: Promise<unknown>) => { setBusy(true); return job.catch((e) => app.notify(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)); };
  const list = v.list();
  return (
    <section>
      <div className="row between"><h2>{t("vault")}</h2><button onClick={() => v.lock()}><IconLock /> {t("vaultLock")}</button></div>
      <p className="muted">{t("vaultAutoLock")}</p>
      {list.length === 0 && <p className="muted">{t("vaultEmpty")}</p>}
      <div className="grid">{list.map((e) => <Entry key={e.id} e={e} />)}</div>
      <form className="card" onSubmit={(e) => { e.preventDefault(); void run(v.put(f).then(() => setF(EMPTY))); }}>
        <h4>{t("vaultAdd")}</h4>
        <input placeholder={t("vaultSite")} value={f.site} inputMode="url" autoCapitalize="off" onChange={(e) => setF({ ...f, site: e.target.value })} />
        <input placeholder={t("vaultLabel")} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        <input placeholder={t("vaultUsername")} value={f.username} autoCapitalize="off" autoComplete="off" onChange={(e) => setF({ ...f, username: e.target.value })} />
        <input type="password" placeholder={t("vaultPassword")} value={f.password} autoComplete="new-password" onChange={(e) => setF({ ...f, password: e.target.value })} />
        <textarea placeholder={t("vaultNote")} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <button className="primary" type="submit" disabled={busy || !f.site.trim() || !f.password}>{t("save")}</button>
      </form>
    </section>
  );
}

/** KrishVault: saved logins. Locked = nothing readable, not even the list. The passphrase is never stored. */
export function Vault() {
  const app = useApp();
  useAppState(); // re-render when the vault loads, locks or unlocks
  const { t } = useT();
  const v = app.vault;
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const run = (job: Promise<unknown>) => { setBusy(true); return job.catch((e) => app.notify(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false)); };

  if (!v.loaded) return <section><h2>{t("vault")}</h2></section>;
  if (v.unreadable) return <section><h2>{t("vault")}</h2><p className="error">{t("vaultUnreadable")}</p></section>;
  if (v.unlocked) return <Unlocked />;

  if (!v.exists) {
    const ok = pass.length >= MIN_PASSPHRASE && pass === pass2;
    return (
      <section>
        <h2>{t("vault")}</h2>
        <p className="muted">{t("vaultIntro")}</p>
        <form className="card" onSubmit={(e) => { e.preventDefault(); void run(v.create(pass).then(() => (setPass(""), setPass2("")))); }}>
          <h4>{t("vaultCreate")}</h4>
          <input type="password" autoComplete="new-password" placeholder={t("vaultPassphrase", { min: String(MIN_PASSPHRASE) })} value={pass} onChange={(e) => setPass(e.target.value)} />
          <input type="password" autoComplete="new-password" placeholder={t("vaultPassphrase2")} value={pass2} onChange={(e) => setPass2(e.target.value)} />
          <p className="muted">{t("vaultNoRecover")}</p>
          {pass2 && pass !== pass2 && <p className="error">{t("vaultMismatch")}</p>}
          <button className="primary" type="submit" disabled={!ok || busy}>{t("vaultCreate")}</button>
        </form>
      </section>
    );
  }

  return (
    <section>
      <h2>{t("vault")}</h2>
      <form className="card" onSubmit={(e) => { e.preventDefault(); void run(v.unlock(pass).then((ok) => { if (ok) setPass(""); else app.notify(t("vaultWrong")); })); }}>
        <div className="card-head"><IconLock /><h4>{t("vaultLocked")}</h4></div>
        <input autoFocus type="password" autoComplete="off" placeholder={t("vaultPassphraseOne")} value={pass} onChange={(e) => setPass(e.target.value)} />
        <div className="row"><button className="primary" type="submit" disabled={!pass || busy}>{t("vaultUnlock")}</button></div>
      </form>
      <button className="ghost" onClick={() => { if (confirm(t("vaultEraseConfirm"))) void run(v.erase()); }}>{t("vaultErase")}</button>
    </section>
  );
}
