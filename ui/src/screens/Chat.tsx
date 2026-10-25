import { useEffect, useRef, useState } from "react";
import { PromptCard } from "../components/Prompts";
import { useApp, useAppState } from "../state/useStore";

export function Chat() {
  const app = useApp();
  const s = useAppState();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [s.items.length, s.prompts.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    void app.send(t);
  };
  return (
    <section className="chat">
      <div className="thread">
        {s.items.length === 0 && <p className="muted">Open a site in the browser window, log in yourself, then tell me what to do.</p>}
        {s.items.map((i) =>
          i.chip ? (
            <button key={i.id} className={`chip ${i.chip.state}`} onClick={app.openWindow}>{i.chip.label}</button>
          ) : (
            <div key={i.id} className={`msg ${i.role}`}>{i.text}</div>
          ),
        )}
        {s.prompts.map((p) => <PromptCard key={p.id} p={p} />)}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={submit}>
        <button type="button" onClick={app.openWindow}>Browser</button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell me what to do" disabled={s.running} />
        <button className="primary" type="submit" disabled={s.running || !text.trim()}>Send</button>
      </form>
    </section>
  );
}
