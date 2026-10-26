import { useEffect, useRef, useState } from "react";
import { ChipPill } from "../components/ChipPill";
import { IconGlobe, IconSend } from "../components/icons";
import { PromptCard } from "../components/Prompts";
import { useT } from "../i18n/useT";
import { lastChip } from "../state/store";
import { useApp, useAppState } from "../state/useStore";

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
    void app.send(m);
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
            <div key={i.id} className={`msg ${i.role}`}>{i.text}</div>
          ),
        )}
        {s.prompts.map((p) => <PromptCard key={p.id} p={p} />)}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={submit}>
        <button type="button" className="icon" aria-label={t("browser")} title={t("browser")} onClick={app.openWindow}><IconGlobe /></button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("composerPlaceholder")} disabled={s.running} />
        <button className="send" type="submit" aria-label={t("send")} title={t("send")} disabled={s.running || !text.trim()}><IconSend /></button>
      </form>
    </section>
  );
}
