import { useT } from "../i18n/useT";
import type { Key } from "../i18n";

const POINTS: Key[] = ["sec1", "sec2", "sec3", "sec4", "sec5", "sec6", "sec7"];

export function Security() {
  const { t } = useT();
  return (
    <section>
      <h2>{t("security")}</h2>
      <ul className="list plain">
        {POINTS.map((k) => <li key={k}>{t(k)}</li>)}
      </ul>
    </section>
  );
}
