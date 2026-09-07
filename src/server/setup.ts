import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir, platform, arch, totalmem, cpus } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import {
  CONFIG_PATH,
  hasCustomEnv,
  readConfigFile,
  updateConfig,
  type AppConfig,
} from "./config.ts";
import type { SetupHardware, SetupStatus } from "../shared/types.ts";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url)); // survives spaces in path
const LLM_LOG = join(DATA_DIR, "llm.log");

// --- model catalogue (verified 2026-09-07, Apache 2.0, prism-ml on HF) ----------

export const MODELS = {
  b27: { model: "prism-ml/Bonsai-27B-gguf", sizeGb: 3.9 },
  b8: { model: "prism-ml/Bonsai-8B-gguf", sizeGb: 1.16 },
} as const;
const RAM_TRESHOLD_GB = 16; // 27B peaks at 5.2 GB @4K ctx — 16 GB machines are comfy
// overridable so tests (and port-conflicted setups) can point elsewhere
export const LMSTUDIO_BASE = process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1";

// --- hardware -------------------------------------------------------------------

export type Hardware = SetupHardware;

export function detectHardware(): Hardware {
  const os = platform() === "darwin" ? "mac" : platform() === "win32" ? "win" : "linux";
  let appleSilicon = os === "mac" && arch() === "arm64";
  if (os === "mac" && !appleSilicon) {
    // Rosetta caveat: node may report x64 on Apple Silicon
    const { stdout } = spawnSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf8" });
    appleSilicon = typeof stdout === "string" && stdout.includes("Apple");
  }
  const chip = cpus()[0]?.model?.trim() || "Unknown CPU";
  return { os, chip, ramGb: Math.round(totalmem() / 2 ** 30), appleSilicon };
}

export function suggestModel(hw: Hardware): {
  model: string;
  sizeGb: number;
  mlx: { model: string; sizeGb: number } | null;
} {
  if (hw.ramGb >= RAM_TRESHOLD_GB) {
    return {
      model: MODELS.b27.model,
      sizeGb: MODELS.b27.sizeGb,
      mlx: hw.appleSilicon ? { model: "prism-ml/Bonsai-27B-mlx-1bit", sizeGb: 5.13 } : null,
    };
  }
  return {
    model: MODELS.b8.model,
    sizeGb: MODELS.b8.sizeGb,
    mlx: hw.appleSilicon ? { model: "prism-ml/Bonsai-8B-mlx-1bit", sizeGb: 1.3 } : null,
  };
}

// --- lms resolution -------------------------------------------------------------

const lmsDefaultPath = (): string =>
  platform() === "win32"
    ? join(homedir(), ".lmstudio", "bin", "lms.exe")
    : join(homedir(), ".lmstudio", "bin", "lms");

/** LMS_PATH env > config.json lmsPath > platform default if it exists > PATH lookup. */
export function resolveLms(): string | null {
  if (process.env.LMS_PATH) return process.env.LMS_PATH;
  const cfg = readConfigFile();
  if (cfg.lmsPath && existsSync(cfg.lmsPath)) return cfg.lmsPath;
  const def = lmsDefaultPath();
  if (existsSync(def)) return def;
  const probe = spawnSync("lms", ["--version"], { encoding: "utf8" });
  return probe.status === 0 ? "lms" : null;
}

// --- process helpers -------------------------------------------------------------

const log = (line: string): void => {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(LLM_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging must never crash the app */
  }
};

const httpOk = async (url: string, timeoutMs: number): Promise<boolean> => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
};

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn lms (array args, no shell), collect output, log it. Never throws on
 * nonzero exit — the caller decides via the returned code. Timeout: SIGTERM,
 * then SIGKILL after a grace window; the promise always settles.
 */
function runLms(lms: string, args: string[], timeoutMs = 60_000): Promise<RunResult> {
  log(`$ ${lms} ${args.join(" ")}`);
  return new Promise((resolve) => {
    const child = spawn(lms, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let done = false;
    const settle = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      if (!done) {
        log(`timeout dopo ${timeoutMs}ms — SIGTERM`);
        child.kill("SIGTERM");
      }
    }, timeoutMs);
    // SIGTERM ignored (or children keeping pipes open) → hard kill + settle anyway
    const killer = setTimeout(() => {
      if (!done) {
        log("SIGTERM ignorato — SIGKILL");
        child.kill("SIGKILL");
      }
    }, timeoutMs + 5000);
    setTimeout(() => settle(-1), timeoutMs + 15000); // last resort: promise must settle
    child.stdout.on("data", (c: Buffer) => {
      stdout += c;
      jobFeed(c.toString());
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c;
      jobFeed(c.toString());
    });
    child.on("error", (e) => {
      log(`spawn error: ${e.message}`);
      stderr += e.message;
      settle(-1);
    });
    child.on("close", (code) => settle(code));
  });
}

// --- download / install job (singleton) ------------------------------------------

export type JobState = "idle" | "installing-cli" | "downloading" | "done" | "error";

export interface SetupJob {
  state: JobState;
  model: string | null;
  logTail: string;
  error?: string;
}

let job: SetupJob = { state: "idle", model: null, logTail: "" };
const jobActive = (): boolean => job.state === "downloading" || job.state === "installing-cli";

/** Feed the wizard's log view; ring buffer keeps the last ~2 KB. */
function jobFeed(text: string): void {
  if (!jobActive()) return;
  job.logTail = (job.logTail + text).slice(-2000);
}

// model keys are HF-style org/repo; require it to start alphanumeric (no ".."-leading tricks)
const MODEL_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function startDownload(model: string): void {
  if (jobActive()) throw new Error("busy");
  if (!MODEL_KEY_RE.test(model)) throw new Error("invalid_model");
  const lms = resolveLms();
  if (!lms) throw new Error("lms_missing");
  job = { state: "downloading", model, logTail: "" };
  // --gguf/--mlx flag: defensive disambiguation between repo variants
  const flag = model.includes("-mlx") ? "--mlx" : "--gguf";
  void runLms(lms, ["get", model, flag], 60 * 60 * 1000).then((r) => {
    if (r.code === 0) job = { state: "done", model, logTail: job.logTail };
    else {
      log(`download fallito: ${r.stderr.slice(-500)}`);
      job = { state: "error", model, logTail: job.logTail, error: r.stderr.slice(-300) || `exit ${r.code}` };
    }
  });
}

/** SECURITY NOTE: fixed official install scripts, never interpolated — see plan. */
export function installCli(): void {
  if (jobActive()) throw new Error("busy");
  const os = detectHardware().os;
  if (os === "win") {
    job = { state: "installing-cli", model: null, logTail: "" };
    // fixed string on purpose: official LM Studio PowerShell installer
    runInstall(["powershell", "-NoProfile", "-Command", "irm https://lmstudio.ai/install.ps1 | iex"]);
  } else if (os === "mac") {
    job = { state: "installing-cli", model: null, logTail: "" };
    // fixed string on purpose: official LM Studio bash installer
    runInstall(["bash", "-c", "curl -fsSL https://lmstudio.ai/install.sh | bash"]);
  } else {
    job = { state: "error", model: null, logTail: "", error: "unsupported OS — try: npx lmstudio install-cli" };
  }
}

function runInstall(cmd: string[]): void {
  const child = spawn(cmd[0]!, cmd.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
  let done = false;
  const finish = (state: JobState, error?: string): void => {
    if (done) return;
    done = true;
    job = { state, model: null, logTail: job.logTail, ...(error ? { error } : {}) };
  };
  // installer must never wedge the job singleton: 10 min then hard stop
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 5000);
    setTimeout(() => finish("error", "installer timed out (10 min)"), 6500);
  }, 10 * 60 * 1000);
  child.stdout.on("data", (c: Buffer) => jobFeed(c.toString()));
  child.stderr.on("data", (c: Buffer) => jobFeed(c.toString()));
  child.on("error", (e) => {
    clearTimeout(timer);
    finish("error", e.message);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (code === 0) finish("done");
    else finish("error", `exit ${code}`);
  });
}

export function getJob(): SetupJob {
  return job;
}

// --- auto-config on every app start ---------------------------------------------

export type BackendState = "up" | "starting" | "off";
let backendState: BackendState = "off";
let ensureLock: Promise<void> | null = null;

export function llmBackendState(): BackendState {
  return backendState;
}

/** Fire-and-forget: bring the LM Studio server up with the configured model. */
export function ensureLlmServer(): void {
  const cfg = readConfigFile();
  if (!cfg.setupDone || cfg.backend !== "lmstudio" || !cfg.model) return;
  if (hasCustomEnv()) return; // env LLM_BASE_URL wins everywhere — hands off
  if (ensureLock) return; // ponytail: single global lock, mono-user server
  backendState = "starting";
  ensureLock = run()
    .catch((e) => {
      log(`ensure fallito: ${e}`);
      backendState = "off";
    })
    .finally(() => {
      ensureLock = null;
    });
}

async function run(): Promise<void> {
  const cfg = readConfigFile();
  const base = cfg.baseUrl ?? LMSTUDIO_BASE;
  if (await httpOk(`${base}/models`, 2000)) {
    backendState = "up";
    return;
  }
  const lms = resolveLms();
  if (!lms) {
    log("lms non trovato — backend LLM non avviato");
    backendState = "off";
    return;
  }
  const daemon = await runLms(lms, ["daemon", "up"], 30_000);
  if (daemon.code !== 0) log(`daemon up: exit ${daemon.code} — ${daemon.stderr.slice(-200)}`);
  const server = await runLms(lms, ["server", "start"], 30_000);
  if (server.code !== 0) {
    log(`server start: exit ${server.code} — ${server.stderr.slice(-200)} (porta occupata?)`);
    backendState = "off";
    return;
  }
  const ls = await runLms(lms, ["ls", "--json"], 30_000);
  let installed = false;
  try {
    const parsed = JSON.parse(ls.stdout) as { models?: { key?: string; path?: string }[] };
    installed = (parsed.models ?? []).some((m) => (m.key ?? m.path) === cfg.model);
  } catch {
    /* unparseable output — treat as absent */
  }
  if (!installed) {
    if (jobActive()) {
      log("un download del wizard è già in corso — salto l'auto-get");
      backendState = "off";
      return;
    }
    log(`modello ${cfg.model} assente — lo scarico (può volerci molto)`);
    const dl = await runLms(lms, ["get", cfg.model!, cfg.model!.includes("-mlx") ? "--mlx" : "--gguf"], 60 * 60 * 1000);
    if (dl.code !== 0) {
      log(`download: exit ${dl.code}`);
      backendState = "off";
      return;
    }
  }
  const load = await runLms(lms, ["load", cfg.model!, "-y", "--gpu=max", "--context-length=8192"], 180_000);
  if (load.code !== 0) {
    // a 200 on /v1/models means nothing if the model failed to load — stay off
    log(`load: exit ${load.code} — ${load.stderr.slice(-200)}`);
    backendState = "off";
    return;
  }
  for (let i = 0; i < 10 && !(await httpOk(`${base}/models`, 2000)); i++) {
    await new Promise((r) => setTimeout(r, 2000));
  }
  backendState = (await httpOk(`${base}/models`, 2000)) ? "up" : "off";
  log(`backend: ${backendState}`);
}

// --- downloaded models (memoized) --------------------------------------------------

let lsCache: { at: number; models: string[] } | null = null;

async function downloadedModels(lms: string | null): Promise<string[]> {
  if (!lms) return [];
  if (lsCache && Date.now() - lsCache.at < 10_000) return lsCache.models;
  const ls = await runLms(lms, ["ls", "--json"], 15_000);
  if (ls.code !== 0) return lsCache?.models ?? []; // don't cache failures
  let models: string[] = [];
  try {
    const parsed = JSON.parse(ls.stdout) as { models?: { path?: string; key?: string }[] };
    models = (parsed.models ?? [])
      .map((m) => m.key ?? m.path ?? "")
      .filter((s) => s.length > 0);
  } catch {
    /* non-json output (older lms) — treat as unknown, uncached */
    return lsCache?.models ?? [];
  }
  lsCache = { at: Date.now(), models };
  return models;
}

// --- routes -----------------------------------------------------------------------

export const setupRoutes = new Hono();

/** Backend state reconciled with a live probe at read time, so the two never disagree. */
function reportedLlmState(serverUp: boolean): BackendState {
  if (serverUp) return "up";
  return backendState === "starting" ? "starting" : "off";
}

setupRoutes.get("/status", async (c) => {
  const cfg = readConfigFile();
  const hw = detectHardware();
  const lms = resolveLms();
  const [models, serverUp] = await Promise.all([
    jobActive() ? [] : downloadedModels(lms),
    httpOk(`${cfg.baseUrl ?? LMSTUDIO_BASE}/models`, 1000),
  ]);
  // disclosure-minimal: no absolute binary path, no raw env details beyond hw summary
  const status: SetupStatus = {
    setupDone: Boolean(cfg.setupDone),
    customEnv: hasCustomEnv(),
    hardware: hw,
    suggested: suggestModel(hw),
    lms: { installed: lms != null, path: null, serverUp },
    downloadedModels: models,
    job,
    llm: { state: reportedLlmState(serverUp) },
  };
  return c.json(status);
});

setupRoutes.post("/install-cli", (c) => {
  try {
    installCli();
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: String((e as Error).message) }, 409);
  }
});

setupRoutes.post("/download", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { model?: string } | null;
  if (!body?.model) return c.json({ error: "invalid_request" }, 400);
  try {
    startDownload(body.model);
    return c.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return c.json({ error: msg }, msg === "busy" ? 409 : 400);
  }
});

setupRoutes.post("/finish", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { model?: string; baseUrl?: string; backend?: "skipped" }
    | null;
  if (!body) return c.json({ error: "invalid_request" }, 400);
  if (body.backend === "skipped") {
    updateConfig({ setupDone: true, backend: "skipped" });
    return c.json({ ok: true });
  }
  if (body.model != null && !MODEL_KEY_RE.test(body.model)) {
    return c.json({ error: "invalid_model" }, 400);
  }
  if (body.baseUrl != null) {
    if (!/^https?:\/\/[\w.:/-]+$/.test(body.baseUrl)) return c.json({ error: "invalid_url" }, 400);
    const patch: AppConfig = { setupDone: true, backend: "custom", baseUrl: body.baseUrl };
    if (body.model) patch.model = body.model;
    updateConfig(patch);
    return c.json({ ok: true });
  }
  if (!body.model) return c.json({ error: "invalid_model" }, 400);
  const lms = resolveLms();
  if (!lms) return c.json({ error: "lms_missing" }, 400);
  updateConfig({
    setupDone: true,
    backend: "lmstudio",
    model: body.model,
    baseUrl: LMSTUDIO_BASE,
    lmsPath: lms,
  });
  ensureLlmServer();
  return c.json({ ok: true });
});

setupRoutes.post("/reset", (c) => {
  try {
    unlinkSync(CONFIG_PATH);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      return c.json({ error: "reset_failed" }, 500);
    }
  }
  // reset shared state too, so the app truly returns to pre-setup
  updateConfig({});
  job = { state: "idle", model: null, logTail: "" };
  lsCache = null;
  return c.json({ ok: true });
});
