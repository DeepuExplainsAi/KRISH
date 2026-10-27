import { useState } from "react";
import { MIN_PASSPHRASE } from "@krish/core";
import { useT } from "../i18n/useT";
import type { Prompt } from "../state/store";
import { useApp } from "../state/useStore";
import { IconAsk, IconClose, IconLock, IconWarn } from "./icons";

function Head({ icon, title, onClose, closeLabel }: { icon: React.JSX.Element; title: string; onClose?: () => void; closeLabel: string }) {
  return (
    <div className="card-head">
      {icon}
      <h4>{title}</h4>
      {onClose && <button type="button" className="round small" aria-label={closeLabel} onClick={onClose}><IconClose size={16} /></button>}
    </div>
  );
}

type LoginPrompt = Extract<Prompt, { type: "login" }>;

/** Sign-in card: email and password (or Google) typed here go straight into the page, never to the AI. Can save the login to KrishVault. */
function LoginCard({ p, done }: { p: LoginPrompt; done: (v: unknown) => void }) {
  const { t } = useT();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [save, setSave] = useState(true);
  const [master, setMaster] = useState("");
  const [show, setShow] = useState(false);
  const { site, google, save: canSave, wall } = p.req;
  const needMaster = Boolean(canSave === "new" && save);
  const ready = user.trim() !== "" && (wall || pass !== "") && (!needMaster || master.length >= MIN_PASSPHRASE);
  const field = { autoCapitalize: "off", autoCorrect: "off", spellCheck: false } as const;
  return (
    <form className="glass card login" onSubmit={(e) => { e.preventDefault(); if (ready) done({ username: user.trim(), password: pass, save: Boolean(canSave) && save, passphrase: needMaster ? master : undefined }); }}>
      <Head icon={<IconLock />} title={t("signInTo", { site })} closeLabel={t("takeOver")} onClose={() => done(undefined)} />
      {google && <button type="button" className="google" onClick={() => done({ google: true })}><span aria-hidden="true">G</span>{t("continueGoogle")}</button>}
      {google && <p className="or">{t("orWithEmail")}</p>}
      <input {...field} autoFocus={!google} type="text" inputMode="email" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} placeholder={t("emailOrUser")} aria-label={t("emailOrUser")} />
      {!wall && <div className="pw">
        <input {...field} type={show ? "text" : "password"} autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={t("password")} aria-label={t("password")} />
        <button type="button" className="round small" onClick={() => setShow(!show)} aria-label={show ? t("hide") : t("show")}>{show ? "◌" : "●"}</button>
      </div>}
      {canSave && <label className="save"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> {t("saveLogin")}</label>}
      {needMaster && <input {...field} type="password" autoComplete="new-password" value={master} onChange={(e) => setMaster(e.target.value)} placeholder={t("newPassphrase", { n: String(MIN_PASSPHRASE) })} aria-label={t("newPassphrase", { n: String(MIN_PASSPHRASE) })} />}
      <div className="row end"><button className="dark" type="submit" disabled={!ready}>{t("signIn")}</button></div>
      <p className="secured"><IconLock />{t("loginNote")}</p>
    </form>
  );
}

/** Native cards in the chat. Secure values go straight to the page via the app; never to a model. */
export function PromptCard({ p }: { p: Prompt }) {
  const app = useApp();
  const { t } = useT();
  const [text, setText] = useState("");
  const done = (v: unknown) => { setText(""); app.answer(p.id, v); };

  if (p.type === "confirm") {
    return (
      <div className="glass card confirm">
        <Head icon={<IconWarn />} title={p.req.title} closeLabel={t("cancel")} onClose={() => done(false)} />
        <pre>{p.req.preview}</pre>
        <div className="row">
          <button className="dark" onClick={() => done(true)}>{t("confirm")}</button>
          <button className="ghost" onClick={() => done(false)}>{t("cancel")}</button>
        </div>
      </div>
    );
  }
  if (p.type === "takeover") {
    return (
      <div className="glass card">
        <Head icon={<IconWarn />} title={t("actionRequired")} closeLabel={t("close")} />
        <p>{p.reason}</p>
        <button className="dark" onClick={() => done(undefined)}>{t("resume")}</button>
      </div>
    );
  }
  if (p.type === "login") return <LoginCard p={p} done={done} />;
  const secure = p.type === "secure";
  const cancellable = !(secure && p.kind === "captcha");
  return (
    <form className="glass card" onSubmit={(e) => { e.preventDefault(); done(text); }}>
      <Head
        icon={secure ? <IconLock /> : <IconAsk />}
        title={secure ? t("actionRequired") : t("question")}
        closeLabel={t("cancel")}
        onClose={cancellable ? () => done(undefined) : undefined}
      />
      <p className="ask">{secure ? p.title : p.question}</p>
      <p className="muted">{secure ? t("secureNote", { field: p.field, site: p.site }) : t("answerSent")}</p>
      <input
        autoFocus
        type={secure ? "password" : "text"}
        inputMode={secure && p.kind === "otp" ? "numeric" : undefined}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={secure ? p.field : t("yourAnswer")}
        aria-label={secure ? p.field : t("question")}
      />
      <div className="row end">
        <button className="dark" type="submit">{t("continue")}</button>
      </div>
      {secure && <p className="secured"><IconLock />{t("securedBy")}</p>}
    </form>
  );
}
