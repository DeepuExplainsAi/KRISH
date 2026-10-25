import { useApp, useAppState } from "../state/useStore";

export function Settings() {
  const app = useApp();
  const s = useAppState();
  const st = s.settings;
  const toggle = (k: "liteMode" | "screenshots" | "desktopLayout" | "linuxSandbox" | "localModel") => (e: React.ChangeEvent<HTMLInputElement>) =>
    void app.saveSettings({ [k]: e.target.checked });
  return (
    <section>
      <h2>Settings</h2>
      <label><input type="checkbox" checked={st.liteMode} onChange={toggle("liteMode")} /> Lite mode (no blur or animation)</label>
      <label><input type="checkbox" checked={st.screenshots} onChange={toggle("screenshots")} /> Send screenshots to the AI (off: text only)</label>
      <label><input type="checkbox" checked={st.desktopLayout} onChange={toggle("desktopLayout")} /> Desktop layout in the browser window (1280×800)</label>
      <h3>Sandbox</h3>
      <p className="muted">Tier 0 (isolated Web Worker: zip, unzip, text, small scripts, no network) is always on.</p>
      <h4>Sandbox files</h4>
      <ul className="list">
        {app.sandboxFiles.map((f) => (
          <li key={f.name}><span>{f.name} · {f.size} B</span>
            <span className="row"><button onClick={() => void app.saveSandboxFile(f.name)}>Save…</button><button onClick={() => app.removeSandboxFile(f.name)}>✕</button></span></li>
        ))}
      </ul>
      <button onClick={() => void app.addSandboxFile()}>Add file…</button>
      <label>
        <input type="checkbox" checked={st.linuxSandbox && s.linuxAvailable} disabled={!s.linuxAvailable} onChange={toggle("linuxSandbox")} /> Linux sandbox (Tier 1)
      </label>
      {!s.linuxAvailable && <p className="muted">{s.deviceLowRam ? "Disabled: this device has low RAM." : "Not included in this build (use the full flavor)."}</p>}
      <h3>Experimental</h3>
      <label><input type="checkbox" checked={st.localModel} onChange={toggle("localModel")} /> On-device model via WebGPU (falls back to your providers)</label>
      <h3>Data</h3>
      <button onClick={() => void app.clearAllSiteData()}>Clear all site data</button>
      <button onClick={() => void app.memory.clear()}>Clear memory</button>
      <button onClick={() => void app.history.clear()}>Clear history</button>
    </section>
  );
}
