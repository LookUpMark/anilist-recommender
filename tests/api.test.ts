import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { join } from "node:path";

const PORT = 4790;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForServer(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not start");
}

test("API smoke: fixture mode serves profile, recommendations, graceful LLM fallback", async () => {
  const child = spawn(process.execPath, ["src/server/index.ts"], {
    cwd: join(import.meta.dirname, ".."),
    env: {
      ...process.env,
      ANILIST_FIXTURES: "fixtures",
      PORT: String(PORT),
      LLM_BASE_URL: "http://127.0.0.1:59999/v1", // unreachable → graceful fallback
    },
    stdio: "ignore",
  });
  try {
    await waitForServer();

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
  }
});
