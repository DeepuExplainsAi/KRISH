import { useState } from "react";
import { useT } from "../i18n/useT";
import type { Key } from "../i18n";
import { useApp, useAppSelector } from "../state/useStore";
import { IconChat, IconKey, IconSend, IconVault } from "./icons";

const STEPS: { icon: () => React.JSX.Element; title: Key; body: Key; go?: "providers" | "vault" }[] = [
  { icon: IconChat, title: "tour1Title", body: "tour1Body" },
  { icon: IconSend, title: "tour2Title", body: "tour2Body" },
  { icon: IconVault, title: "tour3Title", body: "tour3Body", go: "vault" },
  { icon: IconKey, title: "tour4Title", body: "tour4Body", go: "providers" },
];

/** First-run walkthrough: four cards, skippable at any time, shown once and again from Settings. */
export function Tour() {
  const app = useApp();
  const done = useAppSelector((s) => s.settings.tourDone);
  const { t } = useT();
  const [i, setI] = useState(0);
  if (done) return null;
  const step = STEPS[i]!;
  const Icon = step.icon;
  const last = i === STEPS.length - 1;
  const finish = (go?: "providers" | "vault") => {
    void app.saveSettings({ tourDone: true });
    setI(0);
    if (go) app.go(go);
  };
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="glass card tour-card">
        <span className="tour-icon"><Icon /></span>
        <h3 id="tour-title">{t(step.title)}</h3>
        <p>{t(step.body)}</p>
        <div className="dots-nav" aria-hidden="true">{STEPS.map((_, n) => <i key={n} className={n === i ? "on" : ""} />)}</div>
        <div className="row between">
          <button className="ghost" onClick={() => finish()}>{t("tourSkip")}</button>
          <span className="row">
            {step.go && <button onClick={() => finish(step.go)}>{t("tourTryIt")}</button>}
            <button className="primary" onClick={() => (last ? finish() : setI(i + 1))}>{last ? t("tourDone") : t("continue")}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
