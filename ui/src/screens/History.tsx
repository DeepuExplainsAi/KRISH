import type { HistoryEntry } from "@krish/core";
import { useEffect, useState } from "react";
import { useApp } from "../state/useStore";

export function History() {
  const app = useApp();
  const [rows, setRows] = useState<HistoryEntry[]>([]);
  const [open, setOpen] = useState<string>();
  const reload = () => void app.history.list().then((r) => setRows(r.reverse()));
  useEffect(reload, [app]);
  const runs = rows.filter((r) => r.kind === "run_start");
  return (
    <section>
      <h2>History</h2>
      <p className="muted">Everything the agent did, stored only on this device. Secrets are redacted before saving.</p>
      <button onClick={() => void app.history.clear().then(reload)}>Clear history</button>
      {runs.length === 0 && <p className="muted">Nothing yet.</p>}
      {runs.map((r) => (
        <div className="card" key={r.id}>
          <button className="link" onClick={() => setOpen(open === r.runId ? undefined : r.runId)}>
            <strong>{r.label}</strong><br /><small>{new Date(r.at).toLocaleString()}</small>
          </button>
          {open === r.runId && (
            <ul className="list">
              {rows.filter((x) => x.runId === r.runId && x.kind !== "run_start").reverse().map((x) => (
                <li key={x.id}><span>{x.kind === "chip" ? `● ${x.label} (${x.state})` : `${x.kind}: ${x.label}${x.detail ? ` → ${x.detail}` : ""}`}</span></li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
