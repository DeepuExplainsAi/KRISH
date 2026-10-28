import { NO_PROVIDER_PREFIX } from "@krish/core";
import { useEffect, useRef, useState } from "react";
import { ChipPill } from "../components/ChipPill";
import { LiveWindow } from "../components/LiveWindow";
import { IconClip, IconClose, IconGlobe, IconSend } from "../components/icons";
import { PromptCard } from "../components/Prompts";
import { useT } from "../i18n/useT";
import { lastChip, MAX_ATTACHMENTS } from "../state/store";
import { useApp, useAppSelector } from "../state/useStore";

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

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
  const prompts = useAppSelector((s) => s.prompts);
  const attachments = useAppSelector((s) => s.attachments);
  const running = useAppSelector((s) => s.running);
  const queue = useAppSelector((s) => s.queue);
  const s = { items, prompts, attachments, running, queue };
  const { t } = useT();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: newer Chrome/WebView return a Promise from scrollIntoView, and a returned value is treated as the effect cleanup.
  const lastItem = items[items.length - 1];
  const thinking = running && prompts.length === 0 && !(lastItem?.chip?.state === "running");
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [items.length, prompts.length, thinking]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const m = text.trim();
    if (!m) return;
    setText("");
    void app.send(m, { files: s.attachments });
  };
  const lastChipId = lastChip(s.items)?.id;
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
        {s.items.map((i) =>
          i.chip ? (
            <ChipPill key={i.id} label={i.chip.label} state={i.chip.state} latest={s.running && i.id === lastChipId} onClick={app.openWindow} />
          ) : (
            <div key={i.id} className={`msg ${i.role}${i.failed ? " failed" : ""}${i.plan ? " plan" : ""}`}>
              {i.failed && i.text?.startsWith(NO_PROVIDER_PREFIX) ? <ProviderFailure text={i.text} /> : i.text}
              {i.failed && (
                <span className="row">
                  {i.text?.startsWith(NO_PROVIDER_PREFIX) && <button type="button" className="primary" onClick={() => app.go("providers")}>{t("openApiKeys")}</button>}
                  <button type="button" onClick={() => app.dismissItem(i.id)}>{t("dismiss")}</button>
                </span>
              )}
              {i.files?.map((f) => <span key={f.name} className="file-chip static"><IconClip /><span className="txt">{f.name}</span><small>{fmtSize(f.size)}</small></span>)}
            </div>
          ),
        )}
        {thinking && <Thinking />}
        {s.queue.map((q, n) => (
          <div key={q.id} className="msg user queued">
            <span className="txt">{q.command}</span>
            <small>{t("queuedN", { n: String(n + 1) })}</small>
            <button type="button" className="icon" aria-label={t("remove")} title={t("remove")} onClick={() => app.dequeue(q.id)}><IconClose size={14} /></button>
          </div>
        ))}
        {s.prompts.map((p) => <PromptCard key={p.id} p={p} />)}
        <div ref={end} />
      </div>
      <LiveWindow />
      {s.attachments.length > 0 && (
        <div className="attachments" aria-label={t("attachments")}>
          {s.attachments.map((f) => (
            <span key={f.token} className="file-chip">
              <IconClip /><span className="txt">{f.name}</span><small>{fmtSize(f.size)}</small>
              <button type="button" aria-label={t("removeFile", { name: f.name })} title={t("remove")} onClick={() => app.detach(f.token)}><IconClose size={14} /></button>
            </span>
          ))}
        </div>
      )}
      <form className="composer" onSubmit={submit}>
        <button type="button" className="icon" aria-label={t("attachFile")} title={t("attachFile")} disabled={s.attachments.length >= MAX_ATTACHMENTS} onClick={() => void app.attach().catch((e: unknown) => app.notify(String(e instanceof Error ? e.message : e)))}><IconClip /></button>
        <button type="button" className="icon" aria-label={t("browser")} title={t("browser")} onClick={app.openWindow}><IconGlobe /></button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={s.running ? t("composerQueue") : t("composerPlaceholder")} enterKeyHint="send" />
        <button className="send" type="submit" aria-label={t("send")} title={t("send")} disabled={!text.trim()}><IconSend /></button>
      </form>
    </section>
  );
}
