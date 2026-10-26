import { nextRun, type Repeat, type ScheduledTask } from "@krish/core";
import { useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { useApp, useAppState } from "../state/useStore";

const fmt = (t?: number) => (t ? new Date(t).toLocaleString() : "—");

export function Tasks() {
  const app = useApp();
  const s = useAppState();
  const { t: tr } = useT();
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
      <h2>{tr("tasks")}</h2>
      <p className="muted">{tr("tasksIntro")}</p>
      <div className="card">
        <h4>{tr("morningBrief")}</h4>
        <label><input type="checkbox" checked={s.settings.brief.enabled} onChange={(e) => void app.enableBrief(e.target.checked)} /> {tr("notifyMorning")}</label>
        <label>{tr("time")} <input type="time" value={`${String(s.settings.brief.hour).padStart(2, "0")}:${String(s.settings.brief.minute).padStart(2, "0")}`}
          onChange={(e) => { const [h = 8, m = 0] = e.target.value.split(":").map(Number); void app.saveSettings({ brief: { ...s.settings.brief, hour: h, minute: m } }); }} /></label>
        <button disabled={s.running} onClick={() => void app.runBrief()}>{tr("runBriefNow")}</button>
      </div>
      {tasks.map((t) => (
        <div className="card" key={t.id}>
          <div className="row between"><strong>{t.title}</strong><button onClick={() => void app.scheduler.remove(t.id).then(() => app.rearmSchedules()).then(reload)}>{tr("delete")}</button></div>
          <p>{t.command}</p>
          <p className="muted">{tr("nextRun", { time: fmt(nextRun(t, t.lastRunAt ?? Date.now())) })}</p>
          <button className="primary" disabled={s.running} onClick={() => void app.send(t.command).then(() => app.scheduler.markRan(t.id, Date.now())).then(() => app.rearmSchedules()).then(reload)}>{tr("runNow")}</button>
        </div>
      ))}
      <form className="card" onSubmit={create}>
        <h4>{tr("newTask")}</h4>
        <input placeholder={tr("title")} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea placeholder={tr("whatShouldIDo")} value={f.command} onChange={(e) => setF({ ...f, command: e.target.value })} />
        <select value={f.every} onChange={(e) => setF({ ...f, every: e.target.value })}>
          <option value="daily">{tr("everyDay")}</option><option value="once">{tr("once")}</option><option value="interval">{tr("everyNMinutes")}</option>
        </select>
        {f.every === "interval" ? <input type="number" min={15} value={f.minutes} onChange={(e) => setF({ ...f, minutes: Number(e.target.value) })} /> : <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />}
        <button type="submit" disabled={!f.title || !f.command}>{tr("add")}</button>
      </form>
    </section>
  );
}
