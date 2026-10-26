import type { Project } from "@krish/core";
import { useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { useApp, useAppState } from "../state/useStore";

export function Projects() {
  const app = useApp();
  const s = useAppState();
  const { t } = useT();
  const [list, setList] = useState<Project[]>([]);
  const [f, setF] = useState({ name: "", instructions: "", startUrl: "" });
  const reload = () => void app.projects.list().then(setList);
  useEffect(reload, [app]);
  const active = s.settings.activeProjectId;
  return (
    <section>
      <h2>{t("projects")}</h2>
      <p className="muted">{t("projectsIntro")}</p>
      {list.map((p) => (
        <div className="card" key={p.id}>
          <div className="row between">
            <strong>{p.name}</strong>
            <span className="row">
              <button className={active === p.id ? "on" : ""} onClick={() => void app.saveSettings({ activeProjectId: active === p.id ? undefined : p.id })}>{active === p.id ? t("active") : t("use")}</button>
              <button onClick={() => void app.projects.remove(p.id).then(reload)}>{t("delete")}</button>
            </span>
          </div>
          <p>{p.instructions}</p>
          {p.startUrl && <button onClick={() => void app.platform.browser.open(p.startUrl!).then(app.openWindow)}>{t("openHost", { host: new URL(p.startUrl).hostname })}</button>}
        </div>
      ))}
      <form className="card" onSubmit={(e) => {
        e.preventDefault();
        if (f.startUrl && !f.startUrl.startsWith("https://")) return app.notify(t("startUrlHttps"));
        void app.projects.create(f.name, f.instructions, f.startUrl || undefined).then(() => (setF({ name: "", instructions: "", startUrl: "" }), reload()));
      }}>
        <h4>{t("newProject")}</h4>
        <input placeholder={t("name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <textarea placeholder={t("standingInstructions")} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
        <input placeholder={t("startUrlOptional")} value={f.startUrl} onChange={(e) => setF({ ...f, startUrl: e.target.value })} />
        <button type="submit" disabled={!f.name}>{t("create")}</button>
      </form>
    </section>
  );
}
