import { NO_PROVIDER_PREFIX } from "@krish/core";
import { useEffect, useRef, useState } from "react";
import { ChipPill } from "../components/ChipPill";
import { LiveWindow } from "../components/LiveWindow";
import { IconClip, IconClose, IconGlobe, IconSend } from "../components/icons";
import { PromptCard } from "../components/Prompts";
import { useT } from "../i18n/useT";
import { lastChip, MAX_ATTACHMENTS } from "../state/store";
import { useApp, useAppState } from "../state/useStore";

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

export function Chat() {
  const app = useApp();
  const s = useAppState();
  const { t } = useT();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: newer Chrome/WebView return a Promise from scrollIntoView, and a returned value is treated as the effect cleanup.
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [s.items.length, s.prompts.length]);

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
        {s.items.length === 0 && <p className="muted empty">{t("chatEmpty")}</p>}
        {s.items.map((i) =>
          i.chip ? (
            <ChipPill key={i.id} label={i.chip.label} state={i.chip.state} latest={s.running && i.id === lastChipId} onClick={app.openWindow} />
          ) : (
            <div key={i.id} className={`msg ${i.role}${i.failed ? " failed" : ""}`}>
              {i.text}
              {i.failed && i.text?.startsWith(NO_PROVIDER_PREFIX) && <button type="button" className="primary" onClick={() => app.go("providers")}>{t("openApiKeys")}</button>}
              {i.files?.map((f) => <span key={f.name} className="file-chip static"><IconClip /><span className="txt">{f.name}</span><small>{fmtSize(f.size)}</small></span>)}
            </div>
          ),
        )}
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
        <button type="button" className="icon" aria-label={t("attachFile")} title={t("attachFile")} disabled={s.running || s.attachments.length >= MAX_ATTACHMENTS} onClick={() => void app.attach().catch((e: unknown) => app.notify(String(e instanceof Error ? e.message : e)))}><IconClip /></button>
        <button type="button" className="icon" aria-label={t("browser")} title={t("browser")} onClick={app.openWindow}><IconGlobe /></button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("composerPlaceholder")} disabled={s.running} />
        <button className="send" type="submit" aria-label={t("send")} title={t("send")} disabled={s.running || !text.trim()}><IconSend /></button>
      </form>
    </section>
  );
}
