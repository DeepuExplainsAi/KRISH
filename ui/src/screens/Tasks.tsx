import { nextRun, type Repeat, type ScheduledTask } from "@krish/core";
import { useEffect, useState } from "react";
import { useApp, useAppState } from "../state/useStore";

const fmt = (t?: number) => (t ? new Date(t).toLocaleString() : "—");

export function Tasks() {
  const app = useApp();
  const s = useAppState();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [f, setF] = useState({ title: "", command: "", every: "daily", time: "09:00", minutes: 60 });
  const reload = () => void app.scheduler.list().then(setTasks);
  useEffect(reload, [app]);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const [hour = 9, minute = 0] = f.time.split(":").map(Number);
    const repeat: Repeat = f.every === "interval" ? { every: "interval", minutes: f.minutes } : { every: f.every as "daily" } ;
    const at = f.every === "once" ? new Date().setHours(hour, minute, 0, 0) + (new Date().setHours(hour, minute, 0, 0) < Date.now() ? 86_400_000 : 0) : undefined;
    void app.scheduler.add({ title: f.title, command: f.command, repeat: f.every === "once" ? { every: "once" } : repeat, hour, minute, at })
      .then(() => app.rearmSchedules()).then(reload);
    setF({ ...f, title: "", command: "" });
  };
  return (
    <section>
      <h2>Scheduled tasks</h2>
      <p className="muted">When a task is due you get a notification (if allowed). Tap it, then press Run. Tasks never run in the background, so you always approve sends.</p>
      <div className="card">
        <h4>Morning brief (off by default)</h4>
        <label><input type="checkbox" checked={s.settings.brief.enabled} onChange={(e) => void app.enableBrief(e.target.checked)} /> Notify me each morning</label>
        <label>Time <input type="time" value={`${String(s.settings.brief.hour).padStart(2, "0")}:${String(s.settings.brief.minute).padStart(2, "0")}`}
          onChange={(e) => { const [h = 8, m = 0] = e.target.value.split(":").map(Number); void app.saveSettings({ brief: { ...s.settings.brief, hour: h, minute: m } }); }} /></label>
        <button disabled={s.running} onClick={() => void app.runBrief()}>Run brief now</button>
      </div>
      {tasks.map((t) => (
        <div className="card" key={t.id}>
          <div className="row between"><strong>{t.title}</strong><button onClick={() => void app.scheduler.remove(t.id).then(() => app.rearmSchedules()).then(reload)}>Delete</button></div>
          <p>{t.command}</p>
          <p className="muted">Next: {fmt(nextRun(t, t.lastRunAt ?? Date.now()))}</p>
          <button className="primary" disabled={s.running} onClick={() => void app.send(t.command).then(() => app.scheduler.markRan(t.id, Date.now())).then(() => app.rearmSchedules()).then(reload)}>Run now</button>
        </div>
      ))}
      <form className="card" onSubmit={create}>
        <h4>New task</h4>
        <input placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea placeholder="What should I do?" value={f.command} onChange={(e) => setF({ ...f, command: e.target.value })} />
        <select value={f.every} onChange={(e) => setF({ ...f, every: e.target.value })}>
          <option value="daily">Every day</option><option value="once">Once</option><option value="interval">Every N minutes</option>
        </select>
        {f.every === "interval" ? <input type="number" min={15} value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })} /> : <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />}
        <button type="submit" disabled={!f.title || !f.command}>Add</button>
      </form>
    </section>
  );
}
