import { useState } from "react";
import type { Prompt } from "../state/store";
import { useApp } from "../state/useStore";

/** Native cards in the chat. Secure values go straight to the page via the app; never to a model. */
export function PromptCard({ p }: { p: Prompt }) {
  const app = useApp();
  const [text, setText] = useState("");
  const done = (v: unknown) => { setText(""); app.answer(p.id, v); };

  if (p.type === "confirm") {
    return (
      <div className="card confirm">
        <h4>{p.req.title}</h4>
        <pre>{p.req.preview}</pre>
        <div className="row">
          <button className="primary" onClick={() => done(true)}>Confirm</button>
          <button onClick={() => done(false)}>Cancel</button>
        </div>
      </div>
    );
  }
  if (p.type === "takeover") {
    return (
      <div className="card">
        <h4>Action required</h4>
        <p>{p.reason}</p>
        <button className="primary" onClick={() => done(undefined)}>Resume</button>
      </div>
    );
  }
  const secure = p.type === "secure";
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); done(text); }}>
      <h4>{secure ? "Action required" : "Question"}</h4>
      <p>{secure ? p.title : p.question}</p>
      {secure && <p className="muted">Goes into <b>{p.field}</b> on <b>{p.site}</b>. Not sent to the AI.</p>}
      {!secure && <p className="muted">Your answer is sent to the AI. Do not type passwords or codes here.</p>}
      <input
        autoFocus
        type={secure ? "password" : "text"}
        inputMode={secure && p.kind === "otp" ? "numeric" : undefined}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={secure ? "Hidden. Goes straight into the page, never to the AI." : "Your answer"}
      />
      <div className="row">
        <button className="primary" type="submit">Continue</button>
        {secure && p.kind === "captcha" ? null : <button type="button" onClick={() => done(undefined)}>Cancel</button>}
      </div>
    </form>
  );
}
