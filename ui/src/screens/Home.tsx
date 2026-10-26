import { useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { useApp, useAppState } from "../state/useStore";

export function Home() {
  const app = useApp();
  const s = useAppState();
  const { t } = useT();
  const [url, setUrl] = useState("https://");
  const [fact, setFact] = useState("");
  const [facts, setFacts] = useState<{ id: string; text: string }[]>([]);
  useEffect(() => void app.memory.list().then(setFacts), [app]);
  const noProvider = s.providers.length === 0;

  const open = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.startsWith("https://")) return app.notify(t("homeOnlyHttps"));
    void app.platform.browser.open(url).then(app.openWindow);
  };
  return (
    <section>
      <h2>{t("home")}</h2>
      {noProvider && (
        <div className="card">
          <p>{t("homeNeedProvider")}</p>
          <button className="primary" onClick={() => app.go("providers")}>{t("addProvider")}</button>
        </div>
      )}
      <form className="row" onSubmit={open}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" aria-label={t("siteAddress")} />
        <button className="primary" type="submit">{t("open")}</button>
      </form>
      <p className="muted">{t("homeLoginNote")}</p>
      <h3>{t("memory")}</h3>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void app.memory.add(fact).then(() => app.memory.list().then(setFacts)); setFact(""); }}>
        <input value={fact} onChange={(e) => setFact(e.target.value)} placeholder={t("memoryPlaceholder")} />
        <button type="submit" disabled={!fact.trim()}>{t("save")}</button>
      </form>
      <ul className="list">
        {facts.map((f) => (
          <li key={f.id}>{f.text}<button aria-label={t("remove")} title={t("remove")} onClick={() => void app.memory.remove(f.id).then(() => app.memory.list().then(setFacts))}>✕</button></li>
        ))}
      </ul>
    </section>
  );
}
