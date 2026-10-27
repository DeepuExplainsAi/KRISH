import { useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { useApp, useAppSelector } from "../state/useStore";

/** Android: switch between the Krish window and the user's own browser app (needs the Accessibility switch). */
export function MyBrowserSetting() {
  const app = useApp();
  const { t } = useT();
  const on = useAppSelector((s) => s.settings.myBrowser);
  const [enabled, setEnabled] = useState(false);
  const check = () => void app.platform.myBrowser?.status().then((r) => setEnabled(r.enabled));
  useEffect(() => {
    check();
    document.addEventListener("visibilitychange", check); // back from the system settings
    return () => document.removeEventListener("visibilitychange", check);
  });
  return (
    <div className="card">
      <label><input type="checkbox" checked={on} onChange={(e) => void app.saveSettings({ myBrowser: e.target.checked })} /> {t("myBrowser")}</label>
      <p className="muted">{t("myBrowserOn")}</p>
      {on && !enabled && (
        <>
          <p className="muted">{t("myBrowserSetupNote")}</p>
          <button className="primary" onClick={() => void app.platform.myBrowser?.openSettings()}>{t("myBrowserSetup")}</button>
        </>
      )}
    </div>
  );
}
