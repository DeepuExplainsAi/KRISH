import { NO_PROVIDER_PREFIX } from "@krish/core";
import { useEffect, useRef, useState } from "react";
import { IconClose, IconSend } from "../components/icons";
import { useT } from "../i18n/useT";
import { useApp, useAppSelector } from "../state/useStore";

const SUGGESTIONS = ["suggest1", "suggest2", "suggest3"] as const;

/** One calm line. The reasons from the providers stay out of the chat: they name services and models the user never chose to see. */
function ProviderFailure({ text }: { text: string }) {
  const { t } = useT();
  const reasons = text.slice(NO_PROVIDER_PREFIX.length).trim().split(" · ").filter(Boolean);
  return (
    <span className="why">
      <strong>{t("noAnswerTitle")}</strong>
      <span>{t("noAnswerHint")}</span>
      {reasons.length > 0 && <small className="muted">{reasons.join(" · ")}</small>}
    </span>
  );
}

/** Shown while the AI works out its next step: a soft shimmer and three dots, like a person typing. */
function Thinking() {
  const { t } = useT();
  return (
    <div className="msg agent thinking" role="status" aria-live="polite">
      <span className="dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="shimmer">{t("thinking")}</span>
    </div>
  );
}

export function Chat() {
  const app = useApp();
  const items = useAppSelector((s) => s.items);
  const running = useAppSelector((s) => s.running);
  const queue = useAppSelector((s) => s.queue);
  const s = { items, running, queue };
  const { t } = useT();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: newer Chrome/WebView return a Promise from scrollIntoView, and a returned value is treated as the effect cleanup.
  const lastItem = items[items.length - 1];
  const thinking = running && lastItem?.role === "user";
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [items.length, thinking]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const m = text.trim();
    if (!m) return;
    setText("");
    void app.send(m);
  };
  return (
    <section className="chat">
      <div className="thread">
        {s.items.length === 0 && (
          <div className="welcome">
            <h2>{t("chatTitle")}</h2>
            <p>{t("chatEmpty")}</p>
            <div className="suggest">
              {SUGGESTIONS.map((k) => <button key={k} type="button" onClick={() => setText(t(k))}>{t(k)}</button>)}
            </div>
          </div>
        )}
        {s.items.map((i) => (
          <div key={i.id} className={`msg ${i.role}${i.failed ? " failed" : ""}`}>
            {i.failed && i.text?.startsWith(NO_PROVIDER_PREFIX) ? <ProviderFailure text={i.text} /> : i.text}
            {i.failed && (
              <span className="row">
                {i.text?.startsWith(NO_PROVIDER_PREFIX) && <button type="button" className="primary" onClick={() => app.go(app.onlineAllowed() ? "providers" : "settings")}>{t(app.onlineAllowed() ? "openApiKeys" : "settings")}</button>}
                <button type="button" onClick={() => app.dismissItem(i.id)}>{t("dismiss")}</button>
              </span>
            )}
          </div>
        ))}
        {thinking && <Thinking />}
        {s.queue.map((q, n) => (
          <div key={q.id} className="msg user queued">
            <span className="txt">{q.command}</span>
            <small>{t("queuedN", { n: String(n + 1) })}</small>
            <button type="button" className="icon" aria-label={t("remove")} title={t("remove")} onClick={() => app.dequeue(q.id)}><IconClose size={14} /></button>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={s.running ? t("composerQueue") : t("composerPlaceholder")} enterKeyHint="send" />
        <button className="send" type="submit" aria-label={t("send")} title={t("send")} disabled={!text.trim()}><IconSend /></button>
      </form>
    </section>
  );
}
