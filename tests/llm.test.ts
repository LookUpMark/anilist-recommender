import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { MediaLite, ScoredReco, TasteProfile } from "../src/shared/types.ts";
import { explainRecos } from "../src/server/llm.ts";

// explainRecos reads LLM_BASE_URL per call — each test points it at its fake server

const media = (id: number): MediaLite => ({
  id,
  title: `m${id}`,
  format: "TV",
  seasonYear: 2015,
  genres: ["Mystery"],
  tags: [{ name: "Psychological", rank: 90, isSpoiler: false }],
  studio: "Madhouse",
  averageScore: 80,
  popularity: 50000,
  coverImage: null,
  coverColor: null,
  siteUrl: null,
  description: null,
  relations: [],
});

const reco = (id: number): ScoredReco => ({
  media: media(id),
  final: 0.8,
  breakdown: { affinity: 0.7, quality: 0.7, community: 0 },
  badges: [],
  rootId: null,
  groupSize: 1,
  why: `deterministic why for ${id}`,
});

const profile: TasteProfile = {
  userName: "test",
  meanScore: 70,
  scoredCount: 10,
  confidence: "ok",
  counts: { CURRENT: 0, PLANNING: 0, COMPLETED: 10, DROPPED: 0, PAUSED: 0, REPEATING: 0 },
  loved: [{ dim: "tag", value: "Psychological", aff: 0.6, support: 5, examples: ["X"] }],
  disliked: [],
  hash: "h1",
};

async function withFakeLLM(
  handler: (body: any, hits: { count: number }) => string,
  fn: (url: string, hits: { count: number }) => Promise<void>,
): Promise<void> {
  const hits = { count: 0 };
  const server: Server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      hits.count++;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: handler(JSON.parse(data), hits) } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  try {
    await fn(url, hits);
  } finally {
    server.close();
  }
}

test("explainRecos: LLM narrations win, fallback for misses, cache serves the second call", async () => {
  // unique profile hash per run → fresh disk cache key
  profile.hash = `h-${Math.random().toString(36).slice(2)}`;
  await withFakeLLM(
    (body) => {
      const ids = [...body.messages.at(-1).content.matchAll(/id=(\d+)/g)].map((m) => Number(m[1]));
      return JSON.stringify(
        ids.map((id) => (id === 2 ? { id, why: "" } : { id, why: `llm says ${id}` })),
      );
    },
    async (url, hits) => {
      process.env.LLM_BASE_URL = url;
      const recos = [reco(1), reco(2)];
      const first = await explainRecos(recos, profile, "en", "testuser");
      assert.equal(first.get(1)?.source, "llm");
      assert.equal(first.get(1)?.text, "llm says 1");
      assert.equal(first.get(2)?.source, "fallback", "empty LLM answer falls back");
      assert.equal(first.get(2)?.text, "deterministic why for 2");
      assert.equal(hits.count, 1);

      const second = await explainRecos(recos, profile, "en", "testuser");
      assert.equal(second.get(1)?.source, "cache");
      assert.equal(hits.count, 1, "second call must not hit the LLM");
    },
  );
});

test("explainRecos: unreachable LLM degrades to deterministic fallbacks without throwing", async () => {
  profile.hash = `h-${Math.random().toString(36).slice(2)}`;
  process.env.LLM_BASE_URL = "http://127.0.0.1:59999/v1"; // nothing listens here
  const out = await explainRecos([reco(7)], profile, "it", "testuser");
  assert.equal(out.get(7)?.source, "fallback");
  assert.ok(out.get(7)?.text.includes("deterministic why for 7"));
});
