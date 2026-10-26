import { useState } from "react";
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
