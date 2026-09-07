import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { readConfigFile, updateConfig, type AppConfig } from "../src/server/config.ts";
import { suggestModel, type Hardware } from "../src/server/setup.ts";

const hw = (over: Partial<Hardware> = {}): Hardware => ({
  os: "mac",
  chip: "Apple M3 Pro",
  ramGb: 36,
  appleSilicon: true,
  ...over,
});

test("suggestModel: RAM thresholds pick 27B vs 8B", () => {
  assert.ok(suggestModel(hw({ ramGb: 16 })).model.includes("27B"));
  assert.ok(suggestModel(hw({ ramGb: 32 })).model.includes("27B"));
  assert.ok(suggestModel(hw({ ramGb: 15 })).model.includes("8B"));
  assert.ok(suggestModel(hw({ ramGb: 8 })).model.includes("8B"));
  assert.equal(suggestModel(hw({ ramGb: 36 })).sizeGb, 3.9);
  assert.equal(suggestModel(hw({ ramGb: 8 })).sizeGb, 1.16);
});

test("suggestModel: MLX variant only on Apple Silicon", () => {
  assert.ok(suggestModel(hw({ appleSilicon: true })).mlx?.model.includes("mlx"));
  assert.equal(suggestModel(hw({ appleSilicon: false })).mlx, null);
});

test("config precedence: env > file > default; corrupt file tolerated", () => {
  const dir = mkdtempSync(join(tmpdir(), "alr-cfg-"));
  const path = join(dir, "config.json");
  try {
    assert.deepEqual(readConfigFile(path), {}, "missing file = empty config");
    writeFileSync(path, "{not json");
    assert.deepEqual(readConfigFile(path), {}, "corrupt file = empty config");
    writeFileSync(
      path,
      JSON.stringify({ setupDone: true, backend: "lmstudio", model: "prism-ml/Bonsai-8B-gguf", baseUrl: "http://127.0.0.1:1234/v1" }),
    );
    const cfg: AppConfig = readConfigFile(path);
    assert.equal(cfg.model, "prism-ml/Bonsai-8B-gguf");
    assert.equal(cfg.backend, "lmstudio");
    updateConfig({ model: "prism-ml/Bonsai-27B-gguf" }, path);
    assert.equal(readConfigFile(path).model, "prism-ml/Bonsai-27B-gguf", "update merges");
    assert.ok(readFileSync(path, "utf8").includes("setupDone"), "other keys preserved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("setup flow with fake lms: status, finish writes config, ensure sequences lms commands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alr-setup-"));
  const cfgPath = join(dir, "config.json");
  const callsPath = join(dir, "lms-calls.log");
  // fake lms: logs argv, answers ls --json with an empty model list, other cmds exit 0
  const fakeLms = join(dir, "fake-lms.sh");
  writeFileSync(
    fakeLms,
    `#!/bin/bash\necho "$0 $*" >> ${JSON.stringify(callsPath)}\nif [ "$1" = "ls" ]; then echo '[]'; fi\nexit 0\n`,
  );
  const { chmodSync } = await import("node:fs");
  chmodSync(fakeLms, 0o755);

  const PORT = 4791;
  const BASE = `http://127.0.0.1:${PORT}`;
  const child: ChildProcess = spawn(process.execPath, ["src/server/index.ts"], {
    cwd: join(import.meta.dirname, ".."),
    env: {
      ...process.env,
      ANILIST_FIXTURES: "fixtures",
      CONFIG_PATH: cfgPath,
      LMS_PATH: fakeLms,
      PORT: String(PORT),
    },
    stdio: "ignore",
  });
  try {
    const deadline = Date.now() + 15000;
    for (;;) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error("server did not start");
      await new Promise((r) => setTimeout(r, 300));
    }

    const status = await (await fetch(`${BASE}/api/setup/status`)).json();
    assert.equal(status.setupDone, false);
    assert.ok(status.hardware.ramGb > 0);
    assert.ok(status.suggested.model.includes("Bonsai"));
    assert.equal(status.lms.installed, true, "fake LMS_PATH must be detected");
    assert.equal(status.job.state, "idle");

    const bad = await fetch(`${BASE}/api/setup/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "bad name!" }),
    });
    assert.equal(bad.status, 400, "model key must be validated");

    const fin = await fetch(`${BASE}/api/setup/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "prism-ml/Bonsai-27B-gguf" }),
    });
    assert.equal(fin.status, 200);
    const cfg = readConfigFile(cfgPath);
    assert.equal(cfg.setupDone, true);
    assert.equal(cfg.backend, "lmstudio");
    assert.equal(cfg.baseUrl, "http://127.0.0.1:1234/v1");

    // ensureLlmServer() was kicked by finish: wait for the full lms sequence
    const deadline2 = Date.now() + 20000;
    let calls = "";
    while (Date.now() < deadline2) {
      try {
        calls = readFileSync(callsPath, "utf8");
      } catch {
        /* not written yet */
      }
      if (calls.includes("load") && calls.includes("--context-length=8192")) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(calls.includes("daemon up"), `expected daemon up in: ${calls}`);
    assert.ok(calls.includes("server start"));
    assert.ok(calls.includes("get prism-ml/Bonsai-27B-gguf --gguf"), "missing model must be downloaded");
    assert.ok(calls.includes("--context-length=8192"), `got: ${calls}`);

    const health = await (await fetch(`${BASE}/api/health`)).json();
    assert.ok(["up", "starting", "off"].includes(health.llm.state));

    // wizard reappears after reset
    await fetch(`${BASE}/api/setup/reset`, { method: "POST" });
    assert.deepEqual(readConfigFile(cfgPath), {});
  } finally {
    child.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
  }
});
