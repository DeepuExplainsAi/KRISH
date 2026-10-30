/** A text-only Q4_K_M GGUF file, not bundled with the application.
 * RAM values are advisory MiB, not a guarantee that inference will fit.
 */
export interface LocalModelCatalogEntry {
  id: string;
  name: string;
  repo: string;
  /** Immutable Hugging Face repository revision; never resolve downloads against main. */
  revision: string;
  file: string;
  sizeBytes: number;
  sha256: string;
  label: string;
  minRamMB: number;
  recommendedRamMB: number;
}

/** Single source of truth shared with the Android plugin. Exact bytes and LFS SHA-256 from the Hugging Face tree API. */
export { default as LOCAL_MODEL_CATALOG } from "../../model-catalog/local-models.json";
import catalog from "../../model-catalog/local-models.json";

/** Android totalMem in MiB is slightly less than nominal RAM. Unknown RAM yields no recommendation. */
export function recommendedLocalModel(totalRamMB: number): LocalModelCatalogEntry | undefined {
  if (!Number.isFinite(totalRamMB) || totalRamMB <= 0) return undefined;
  if (totalRamMB < 3584) return catalog[0];
  if (totalRamMB < 7168) return catalog[1];
  if (totalRamMB < 11264) return catalog[2];
  return catalog[3];
}
