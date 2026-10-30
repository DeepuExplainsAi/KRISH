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

/**
 * Unsloth's Hugging Face tree API reports the exact byte size and LFS SHA-256.
 * Entries are pinned to the repository revisions checked on 2026-10-30.
 * This is metadata only: no downloader or native inference is implemented here.
 */
export const LOCAL_MODEL_CATALOG: readonly LocalModelCatalogEntry[] = [
  {
    id: "qwen3.5-0.8b", name: "Qwen3.5 0.8B", repo: "unsloth/Qwen3.5-0.8B-GGUF",
    revision: "6ab461498e2023f6e3c1baea90a8f0fe38ab64d0", file: "Qwen3.5-0.8B-Q4_K_M.gguf",
    sizeBytes: 532517120, sha256: "bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517",
    label: "Recommended for below 4GB phones", minRamMB: 0, recommendedRamMB: 2048,
  },
  {
    id: "qwen3.5-2b", name: "Qwen3.5 2B", repo: "unsloth/Qwen3.5-2B-GGUF",
    revision: "1c466474d208da1a7c4b8cb87ebcdac78f160e34", file: "Qwen3.5-2B-Q4_K_M.gguf",
    sizeBytes: 1280835840, sha256: "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223",
    label: "Minimum 4GB phones · Recommended for 6GB phones", minRamMB: 3584, recommendedRamMB: 6144,
  },
  {
    id: "qwen3.5-4b", name: "Qwen3.5 4B", repo: "unsloth/Qwen3.5-4B-GGUF",
    revision: "e87f176479d0855a907a41277aca2f8ee7a09523", file: "Qwen3.5-4B-Q4_K_M.gguf",
    sizeBytes: 2740937888, sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
    label: "Recommended for 8GB phones", minRamMB: 7168, recommendedRamMB: 8192,
  },
  {
    id: "qwen3.5-9b", name: "Qwen3.5 9B", repo: "unsloth/Qwen3.5-9B-GGUF",
    revision: "3885219b6810b007914f3a7950a8d1b469d598a5", file: "Qwen3.5-9B-Q4_K_M.gguf",
    sizeBytes: 5680522464, sha256: "03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8",
    label: "Recommended for 12GB+ phones", minRamMB: 11264, recommendedRamMB: 12288,
  },
];

/** Android totalMem in MiB is slightly less than nominal RAM. Unknown RAM yields no recommendation. */
export function recommendedLocalModel(totalRamMB: number): LocalModelCatalogEntry | undefined {
  if (!Number.isFinite(totalRamMB) || totalRamMB <= 0) return undefined;
  if (totalRamMB < 3584) return LOCAL_MODEL_CATALOG[0];
  if (totalRamMB < 7168) return LOCAL_MODEL_CATALOG[1];
  if (totalRamMB < 11264) return LOCAL_MODEL_CATALOG[2];
  return LOCAL_MODEL_CATALOG[3];
}
