import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Minimal .env loader (no dependency): KEY=VALUE lines, existing env wins.
try {
  for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
} catch {
  /* no .env — fine */
}

export const PORT = Number(process.env.PORT ?? 3000);
export const ANILIST_ENDPOINT = "https://graphql.anilist.co";
export const ANILIST_FIXTURES = process.env.ANILIST_FIXTURES ?? "";
export const RATE_PER_MIN = Math.max(1, Number(process.env.RATE_PER_MIN ?? 25));

// --- persisted app config (written by the setup wizard) -------------------------
// Precedence everywhere: env var > data/config.json > hardcoded default.

export interface AppConfig {
  setupDone?: boolean;
  backend?: "lmstudio" | "omlx" | "custom" | "skipped";
  /** lmstudio: lms key · omlx: directory name under ~/.omlx/models */
  model?: string;
  baseUrl?: string;
  lmsPath?: string;
}

export const CONFIG_PATH =
  process.env.CONFIG_PATH ?? new URL("../../data/config.json", import.meta.url).pathname;

/** Tolerant read: any error (missing, corrupt) yields an empty config. */
export function readConfigFile(path: string = CONFIG_PATH): AppConfig {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AppConfig;
  } catch {
    return {};
  }
}

let fileConfig = readConfigFile();

/** Atomic write (tmp + rename) + in-memory refresh. */
export function updateConfig(patch: AppConfig, path: string = CONFIG_PATH): void {
  const merged = { ...readConfigFile(path), ...patch };
  writeFileSync(`${path}.tmp`, JSON.stringify(merged, null, 2));
  renameSync(`${path}.tmp`, path);
  if (path === CONFIG_PATH) fileConfig = merged;
}

export const llmModel = (): string => process.env.LLM_MODEL ?? fileConfig.model ?? "qwen3:8b";
/** Read per call (tests repoint the env at a fake server). */
export const llmBaseUrl = (): string =>
  process.env.LLM_BASE_URL ?? fileConfig.baseUrl ?? "http://127.0.0.1:11434/v1";
export const hasCustomEnv = (): boolean => Boolean(process.env.LLM_BASE_URL);
// explain runs async in the UI: generous timeout covers cold model loads + thinkers
export const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 120_000);

// fileURLToPath survives paths with spaces (URL.pathname does not)
export const CACHE_DIR = process.env.CACHE_DIR ?? join(fileURLToPath(new URL("../../data/", import.meta.url)), "cache");
export const CACHE_TTL_LIST_MS = 60 * 60 * 1000; // 1h — lists change while you watch
export const CACHE_TTL_MEDIA_MS = 7 * 24 * 60 * 60 * 1000; // 7d — metadata is stable
export const CACHE_TTL_EXPL_MS = 7 * 24 * 60 * 60 * 1000;

export const WEIGHTS = {
  // candidate affinity mix (sums to 1 over the -1..1 core)
  tag: 0.5,
  genre: 0.3,
  studio: 0.12,
  era: 0.08,
  // final score mix
  affinity: 0.6,
  quality: 0.28,
  franchiseBonus: 0.12,
  communityPerHit: 0.03,
  communityCap: 0.1,
  // quality mix
  qualityScore: 0.8,
  qualityPop: 0.2,
  // gem score
  gemAffinity: 0.65,
  gemQuality: 0.35,
  gemPopPenalty: 0.3,
  gemMaxPopularity: 40_000,
  gemMinScore: 72,
  gemMinGemScore: 0.45,
  // sentiment
  scoreSpread: 40, // points from your mean = full ±1 weight
  statusBase: { COMPLETED: 0, CURRENT: 0.1, REPEATING: 0.15, PAUSED: -0.25, DROPPED: -0.6 } as Record<string, number>,
  repeatBonus: 0.1,
  repeatCap: 3,
  // profile thresholds
  lovedMin: 0.05,
  supportMin: 2,
  supportShrink: 10,
  topTags: 20,
  topGenres: 8,
  topStudios: 5,
  topDisliked: 10,
} as const;
