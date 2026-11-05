import { useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { useApp, useAppState } from "../state/useStore";

export function Home() {
  const app = useApp();
  const s = useAppState();
  const { t } = useT();
  const [fact, setFact] = useState("");
  const [facts, setFacts] = useState<{ id: string; text: string }[]>([]);
  useEffect(() => void app.memory.list().then(setFacts), [app]);
  const noProvider = s.providers.length === 0 && app.onlineAllowed();

  return (
    <section>
      <h2>{t("home")}</h2>
      {noProvider && (
        <div className="card">
          <p>{t("homeNeedProvider")}</p>
          <button className="primary" onClick={() => app.go("providers")}>{t("addProvider")}</button>
        </div>
      )}
      <p className="muted">{t("homePhoneNote")}</p>
      <button className="primary" onClick={() => app.go("phone")}>{t("phone")}</button>
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
