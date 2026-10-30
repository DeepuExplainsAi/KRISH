import { LOCAL_MODEL_CATALOG, recommendedLocalModel, type LocalModelCatalogEntry } from "@krish/core";
import { LANG_NAMES, type Lang, type LangPref } from "../i18n";
import { useT } from "../i18n/useT";
import type { ThemePref } from "../theme";
import { localModelCompiledIn, webgpuAvailable } from "../local/webgpu";
import { useApp, useAppState } from "../state/useStore";

declare const __KRISH_VERSION__: string;

export function Settings() {
  const app = useApp();
  const s = useAppState();
  const st = s.settings;
  const { t } = useT();
  const toggle = (k: "liteMode" | "autoOpenWindow" | "screenshots" | "desktopLayout" | "freeFallback" | "linuxSandbox" | "localModel") => (e: React.ChangeEvent<HTMLInputElement>) =>
    void app.saveSettings({ [k]: e.target.checked });
  const recommended = recommendedLocalModel(s.deviceTotalRamMB);
  const startDownload = async (model: LocalModelCatalogEntry) => {
    try {
      const info = await app.platform.local.deviceInfo();
      if (info.metered && !confirm(t("nativeModelMetered"))) return;
      if (!st.nativeModelConsent && !confirm(t("nativeModelConsent", { name: model.name, size: (model.sizeBytes / 1e9).toFixed(2) }))) return;
      await app.startNativeDownload(model.id, true);
    } catch { app.notify(t("nativeModelUnsupported")); }
  };
  const modelRow = (model: LocalModelCatalogEntry) => {
    const done = s.nativeInstalled.includes(model.id);
    const progress = s.nativeProgress[model.id];
    const busy = progress?.status === "downloading" || progress?.status === "verifying";
    const paused = progress?.status === "paused" || (progress?.status === "error" && progress.bytes > 0);
    return <li key={model.id}><div>
      <strong>{model.name}</strong>{recommended?.id === model.id && <> · {t("nativeModelRecommended")}</>}
      <div className="muted">{model.label} · {(model.sizeBytes / 1e9).toFixed(2)} GB</div>
      {s.deviceTotalRamMB > 0 && s.deviceTotalRamMB < model.minRamMB && <p className="error">{t("nativeModelWarning")}</p>}
      {progress && (busy || paused) && <div><progress value={progress.bytes} max={progress.total} /> {Math.floor(progress.bytes / progress.total * 100)}% {progress.status === "verifying" && t("nativeModelVerifying")}</div>}
      {app.platform.local.supported && <div className="row">
        {done ? <><button onClick={() => void app.selectNativeModel(model.id)} disabled={st.nativeSelectedModel === model.id}>{st.nativeSelectedModel === model.id ? t("nativeModelSelected") : t("nativeModelSelect")}</button>
          <button onClick={() => void app.controlNativeDownload(model.id, "delete")}>{t("delete")}</button></> : <>
          {!busy && !paused && <button onClick={() => void startDownload(model)}>{t("nativeModelDownload")}</button>}
          {progress?.status === "downloading" && <button onClick={() => void app.controlNativeDownload(model.id, "pause")}>{t("nativeModelPause")}</button>}
          {paused && <button onClick={() => void startDownload(model)}>{t("nativeModelResume")}</button>}
          {(busy || paused) && <button onClick={() => void app.controlNativeDownload(model.id, "cancel")}>{t("nativeModelCancel")}</button>}
        </>}
      </div>}
    </div></li>;
  };
  return (
    <section>
      <h2>{t("settings")}</h2>
      <label>{t("language")}
        <select value={st.language} onChange={(e) => void app.saveSettings({ language: e.target.value as LangPref })}>
          <option value="auto">{t("languageAuto")}</option>
          {(Object.keys(LANG_NAMES) as Lang[]).map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
        </select>
      </label>
      <label>{t("theme")}
        <select value={st.theme} onChange={(e) => void app.saveSettings({ theme: e.target.value as ThemePref })}>
          <option value="auto">{t("themeAuto")}</option>
          <option value="system">{t("themeSystem")}</option>
          <option value="light">{t("themeLight")}</option>
          <option value="dark">{t("themeDark")}</option>
        </select>
      </label>
      <label><input type="checkbox" checked={st.liteMode} onChange={toggle("liteMode")} /> {t("liteMode")}</label>
      <label><input type="checkbox" checked={st.autoOpenWindow} onChange={toggle("autoOpenWindow")} /> {t("autoOpenWindow")}</label>
      <label><input type="checkbox" checked={st.screenshots} onChange={toggle("screenshots")} /> {t("screenshots")}</label>
      <label><input type="checkbox" checked={st.freeFallback} onChange={toggle("freeFallback")} /> {t("freeFallback")}</label>
      <button onClick={() => void app.saveSettings({ tourDone: false })}>{t("tourAgain")}</button>
      <label><input type="checkbox" checked={st.desktopLayout} onChange={toggle("desktopLayout")} /> {t("desktopLayout")}</label>
      <h3>{t("sandbox")}</h3>
      <p className="muted">{t("sandboxTier0")}</p>
      <h4>{t("sandboxFiles")}</h4>
      <ul className="list">
        {app.sandboxFiles.map((f) => (
          <li key={f.name}><span>{f.name} · {f.size} B</span>
            <span className="row"><button onClick={() => void app.saveSandboxFile(f.name)}>{t("saveDots")}</button><button aria-label={t("remove")} title={t("remove")} onClick={() => app.removeSandboxFile(f.name)}>✕</button></span></li>
        ))}
      </ul>
      <button onClick={() => void app.addSandboxFile()}>{t("addFile")}</button>
      <label>
        <input type="checkbox" checked={st.linuxSandbox && s.linuxAvailable} disabled={!s.linuxAvailable} onChange={toggle("linuxSandbox")} /> {t("linuxSandbox")}
      </label>
      {!s.linuxAvailable && <p className="muted">{s.deviceLowRam ? t("linuxLowRam") : t("linuxNotIncluded")}</p>}
      <h3>{t("nativeModelPreview")}</h3>
      <p>{t("nativeModelUnavailable")}</p>
      <p className="muted">{s.deviceTotalRamMB > 0 ? t("nativeModelRam", { ram: (s.deviceTotalRamMB / 1024).toFixed(1) }) : t("nativeModelRamUnknown")}</p>
      {app.platform.local.supported ? <>
        {s.nativeDevice && <p className="muted">{t("nativeModelStorage", { storage: (s.nativeDevice.freeStorageMB / 1024).toFixed(1) })}</p>}
        <p className="muted">{t("nativeModelWifi")}</p>
        {s.nativeError && <p className="error" role="alert">{s.nativeError}</p>}
      </> : <p className="muted">{t("nativeModelUnsupported")}</p>}
      <ul className="list">{LOCAL_MODEL_CATALOG.slice(0, 3).map(modelRow)}</ul>
      <details className="more"><summary>{t("nativeModelMore")}</summary><ul className="list">{LOCAL_MODEL_CATALOG.slice(3).map(modelRow)}</ul></details>
      <label><input type="checkbox" checked disabled /> {t("nativeModelBackup")}</label>
      <p className="muted">{t("nativeModelBackupPending")}</p>
      <h3>{t("experimental")}</h3>
      <label><input type="checkbox" checked={st.localModel} disabled={!webgpuAvailable()}
        onChange={(e) => {
          if (e.target.checked && !st.localModelConsent && !confirm(t("localModelConsent"))) return;
          void app.saveSettings({ localModel: e.target.checked, localModelConsent: e.target.checked || st.localModelConsent });
        }} /> {t("localModel")}</label>
      {!webgpuAvailable() && <p className="muted">{localModelCompiledIn ? t("webgpuMissing") : t("localNotBuilt")}</p>}
      {st.localModel && s.localModels.length > 0 && (
        <select value={st.localModelId ?? ""} onChange={(e) => void app.saveSettings({ localModelId: e.target.value || undefined })}>
          <option value="">{t("chooseModel")}</option>
          {s.localModels.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
        </select>
      )}
      {s.localStatus && <p className="muted">{s.localStatus}</p>}
      <p className="muted">{t("appVersion", { version: typeof __KRISH_VERSION__ === "string" ? __KRISH_VERSION__ : "dev" })}</p>
      <h3>{t("data")}</h3>
      <button onClick={() => void app.clearAllSiteData()}>{t("clearSiteData")}</button>
      <button onClick={() => void app.memory.clear()}>{t("clearMemory")}</button>
      <button onClick={() => void app.history.clear()}>{t("clearHistory")}</button>
    </section>
  );
}
