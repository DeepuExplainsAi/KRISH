import { useEffect, useState } from "react";
import { useApp, useAppState } from "../state/useStore";

export function Home() {
  const app = useApp();
  const s = useAppState();
  const [url, setUrl] = useState("https://");
  const [fact, setFact] = useState("");
  const [facts, setFacts] = useState<{ id: string; text: string }[]>([]);
  useEffect(() => void app.memory.list().then(setFacts), [app]);
  const noProvider = s.providers.length === 0;

  const open = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.startsWith("https://")) return app.notify("Only https:// sites can be opened");
    void app.platform.browser.open(url).then(app.openWindow);
  };
  return (
    <section>
      <h2>Home</h2>
      {noProvider && (
        <div className="card">
          <p>Add an AI provider and your own API key to begin.</p>
          <button className="primary" onClick={() => app.go("providers")}>Add provider</button>
        </div>
      )}
      <form className="row" onSubmit={open}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" aria-label="Site address" />
        <button className="primary" type="submit">Open</button>
      </form>
      <p className="muted">Log in to your accounts inside the browser window. Passwords stay on this device and are never sent to an AI.</p>
      <h3>Memory</h3>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void app.memory.add(fact).then(() => app.memory.list().then(setFacts)); setFact(""); }}>
        <input value={fact} onChange={(e) => setFact(e.target.value)} placeholder="Something I should remember" />
        <button type="submit" disabled={!fact.trim()}>Save</button>
      </form>
      <ul className="list">
        {facts.map((f) => (
          <li key={f.id}>{f.text}<button onClick={() => void app.memory.remove(f.id).then(() => app.memory.list().then(setFacts))}>✕</button></li>
        ))}
      </ul>
    </section>
  );
}
