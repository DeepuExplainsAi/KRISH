import { Panels as PanelStore, type Panel } from "@krish/core";
import { useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { useApp } from "../state/useStore";

export function Panels() {
  const app = useApp();
  const { t } = useT();
  const [panels, setPanels] = useState<Panel[]>([]);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("");
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const reload = () => void app.panels.list().then(setPanels);
  useEffect(reload, [app]);

  return (
    <section>
      <h2>{t("panels")}</h2>
      <p className="muted">{t("panelsIntro", { example: "{{name}}" })}</p>
      {panels.map((p) => (
        <div className="card" key={p.id}>
          <div className="row between"><strong>{p.title}</strong><button onClick={() => void app.panels.remove(p.id).then(reload)}>{t("delete")}</button></div>
          {p.fields.map((f) => (
            <input key={f} placeholder={f} value={values[p.id]?.[f] ?? ""} onChange={(e) => setValues({ ...values, [p.id]: { ...values[p.id], [f]: e.target.value } })} />
          ))}
          <button className="primary" disabled={app.getState().running} onClick={() => void app.send(PanelStore.render(p, values[p.id] ?? {}))}>{t("run")}</button>
        </div>
      ))}
      <form className="card" onSubmit={(e) => { e.preventDefault(); void app.panels.create(title, template).then(() => (setTitle(""), setTemplate(""), reload())); }}>
        <h4>{t("newPanel")}</h4>
        <input placeholder={t("title")} value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea placeholder={t("panelExample")} value={template} onChange={(e) => setTemplate(e.target.value)} />
        <button type="submit" disabled={!title || !template}>{t("create")}</button>
      </form>
    </section>
  );
}
