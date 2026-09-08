import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Bind :0, read the port, release — no fixed-port collisions across test files. */
async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function waitForServer(base: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not start");
}

test("API smoke: fixture mode serves profile, recommendations, graceful LLM fallback", async () => {
  const PORT = await freePort();
  const BASE = `http://127.0.0.1:${PORT}`;
  // fresh CACHE_DIR: a real explanation cache on disk would surface as source:"cache"
  const cacheDir = mkdtempSync(join(tmpdir(), "alr-test-"));
  const child = spawn(process.execPath, ["src/server/index.ts"], {
    cwd: join(import.meta.dirname, ".."),
    env: {
      ...process.env,
      ANILIST_FIXTURES: "fixtures",
      CACHE_DIR: cacheDir,
      PORT: String(PORT),
      LLM_BASE_URL: "http://127.0.0.1:59999/v1", // unreachable → graceful fallback
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const childErr: string[] = [];
  child.stderr!.on("data", (c: Buffer) => childErr.push(c.toString()));
  try {
    await waitForServer(BASE).catch(async (e) => {
      child.kill("SIGTERM");
      await once(child, "exit").catch(() => undefined);
      throw new Error(`${(e as Error).message}\nstderr: ${childErr.join("").slice(-800)}`);
    });

    const health = await (await fetch(`${BASE}/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.llm.enabled, false);

    const prof = await (await fetch(`${BASE}/api/profile/josh`)).json();
    assert.equal(prof.profile.userName, "josh");
    assert.ok(prof.profile.loved.some((d: { value: string }) => d.value === "Psychological"));

    const reco = await (
      await fetch(`${BASE}/api/recommend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "josh", lang: "en" }),
      })
    ).json();
    assert.ok(reco.recos.length >= 5, `expected >=5 recos, got ${reco.recos.length}`);

    const ids = new Set(reco.recos.map((r: { media: { id: number } }) => r.media.id));
    // dropped prequel 201 → sequel 202 excluded
    assert.ok(!ids.has(202), "sequel of a dropped show must be excluded");
    // S1 completed → S2 is the next step
    const s2 = reco.recos.find((r: { media: { id: number } }) => r.media.id === 102);
    assert.ok(s2, "S2 must be recommended");
    assert.ok(s2.badges.includes("NEXT_STEP"));
    // S3 (103) collapsed into its franchise representative
    assert.ok(!ids.has(103), "S3 must be deduped behind its franchise");
    // unseen entry-point series: S1 (300) shown, S2 (301) suppressed
    assert.ok(ids.has(300) && !ids.has(301), "entry point 300 shown, sequel 301 suppressed");
    const ep = reco.recos.find((r: { media: { id: number } }) => r.media.id === 300);
    assert.ok(ep.badges.includes("ENTRY_POINT"));
    // hidden gem
    const gem = reco.recos.find((r: { media: { id: number } }) => r.media.id === 401);
    assert.ok(gem, "gem must be recommended");
    assert.ok(gem.badges.includes("HIDDEN_GEM"));
    // every reco carries a deterministic why
    assert.ok(reco.recos.every((r: { why: string }) => r.why.length > 5));
    assert.ok(reco.profile.loved.length > 0);
    assert.ok(Array.isArray(reco.avoided));

    // explain with LLM down → fallback sources, no error
    const expl = await (
      await fetch(`${BASE}/api/explain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "josh", ids: [102, 300], lang: "en" }),
      })
    ).json();
    assert.equal(expl.explanations.length, 2);
    assert.ok(expl.explanations.every((e: { source: string }) => e.source === "fallback"));

    // validation
    const bad = await fetch(`${BASE}/api/recommend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "bad name!" }),
    });
    assert.equal(bad.status, 400);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => undefined); // no orphan port for the next run
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("API smoke: AniList down + auto toggle → falls back to local fixtures and back", async () => {
  const PORT = await freePort();
  const BASE = `http://127.0.0.1:${PORT}`;
  // no ANILIST_FIXTURES: fixtures engage only through the runtime auto-fallback.
  // fresh CACHE_DIR: a cached AniList response would bypass the outage entirely.
  const cacheDir = mkdtempSync(join(tmpdir(), "alr-test-"));
  const child = spawn(process.execPath, ["src/server/index.ts"], {
    cwd: join(import.meta.dirname, ".."),
    env: {
      ...process.env,
      ANILIST_ENDPOINT: "http://127.0.0.1:1", // connection refused → AniListError
      ANILIST_FIXTURES: "",
      CACHE_DIR: cacheDir,
      PORT: String(PORT),
      LLM_BASE_URL: "http://127.0.0.1:59999/v1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForServer(BASE);

    let health = await (await fetch(`${BASE}/api/health`)).json();
    assert.deepEqual(
      { on: health.local.on, available: health.local.available, auto: health.local.auto },
      { on: false, available: true, auto: true },
    );

    // AniList is dead: the request still succeeds, served from fixtures
    const prof = await (await fetch(`${BASE}/api/profile/josh`)).json();
    assert.equal(prof.profile.userName, "josh");

    health = await (await fetch(`${BASE}/api/health`)).json();
    assert.equal(health.local.on, true, "auto-fallback must have engaged");

    // toggle off → back to live mode (env didn't pin it)
    const toggled = await (
      await fetch(`${BASE}/api/local-mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auto: false }),
      })
    ).json();
    assert.equal(toggled.local.on, false);
    assert.equal(toggled.local.auto, false);

    // {local:false} alone resets the mode but keeps auto armed
    const reset = await (
      await fetch(`${BASE}/api/local-mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auto: true, local: false }),
      })
    ).json();
    assert.equal(reset.local.on, false);
    assert.equal(reset.local.auto, true);

    // toggle validation
    const badToggle = await fetch(`${BASE}/api/local-mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auto: "yes" }),
    });
    assert.equal(badToggle.status, 400);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit").catch(() => undefined);
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
