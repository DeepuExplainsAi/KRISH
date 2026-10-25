import { Panels as PanelStore, type Panel } from "@krish/core";
import { useEffect, useState } from "react";
import { useApp } from "../state/useStore";

export function Panels() {
  const app = useApp();
  const [panels, setPanels] = useState<Panel[]>([]);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("");
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const reload = () => void app.panels.list().then(setPanels);
  useEffect(reload, [app]);

  return (
    <section>
      <h2>Panels</h2>
      <p className="muted">Mini-apps you make: a saved instruction with blanks. Write {"{{name}}"} where a value goes.</p>
      {panels.map((p) => (
        <div className="card" key={p.id}>
          <div className="row between"><strong>{p.title}</strong><button onClick={() => void app.panels.remove(p.id).then(reload)}>Delete</button></div>
          {p.fields.map((f) => (
            <input key={f} placeholder={f} value={values[p.id]?.[f] ?? ""} onChange={(e) => setValues({ ...values, [p.id]: { ...values[p.id], [f]: e.target.value } })} />
          ))}
          <button className="primary" disabled={app.getState().running} onClick={() => void app.send(PanelStore.render(p, values[p.id] ?? {}))}>Run</button>
        </div>
      ))}
      <form className="card" onSubmit={(e) => { e.preventDefault(); void app.panels.create(title, template).then(() => (setTitle(""), setTemplate(""), reload())); }}>
        <h4>New panel</h4>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea placeholder="Reply to {{who}} about {{topic}}" value={template} onChange={(e) => setTemplate(e.target.value)} />
        <button type="submit" disabled={!title || !template}>Create</button>
      </form>
    </section>
  );
}
