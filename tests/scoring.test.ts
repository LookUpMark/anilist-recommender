import assert from "node:assert/strict";
import { test } from "node:test";
import type { ListEntry, MediaLite, TasteProfile } from "../src/shared/types.ts";
import { analyzeFranchises, type FranchiseInfo } from "../src/server/franchise.ts";
import { affinityOf, dedupeFranchises, deterministicWhy, deterministicWhyNot, gemScoreOf, isGem, popNorm, qualityOf, scoreAll } from "../src/server/scoring.ts";

const media = (id: number, over: Partial<MediaLite> = {}): MediaLite => ({
  id,
  title: `m${id}`,
  format: "TV",
  seasonYear: 2015,
  genres: [],
  tags: [],
  studio: null,
  averageScore: 70,
  popularity: 100000,
  coverImage: null,
  coverColor: null,
  siteUrl: null,
  description: null,
  relations: [],
  ...over,
});

const profile: TasteProfile = {
  userName: "test",
  meanScore: 70,
  scoredCount: 10,
  confidence: "ok",
  counts: { CURRENT: 0, PLANNING: 0, COMPLETED: 10, DROPPED: 2, PAUSED: 0, REPEATING: 0 },
  loved: [
    { dim: "tag", value: "Psychological", aff: 0.6, support: 8, examples: ["X"] },
    { dim: "genre", value: "Mystery", aff: 0.4, support: 8, examples: ["X"] },
  ],
  disliked: [{ dim: "genre", value: "Isekai", aff: -0.7, support: 4, examples: ["Y"] }],
  hash: "abc",
};

test("affinity: loved tags push up, disliked genres pull down", () => {
  const loved = media(1, {
    tags: [{ name: "Psychological", rank: 90, isSpoiler: false }],
    genres: ["Mystery"],
  });
  const hated = media(2, { genres: ["Isekai"] });
  const neutral = media(3);
  const aLoved = affinityOf(loved, profile).affinity01;
  const aHated = affinityOf(hated, profile).affinity01;
  const aNeutral = affinityOf(neutral, profile).affinity01;
  assert.ok(aLoved > 0.6, `loved should be high, got ${aLoved}`);
  assert.ok(aHated < 0.4, `hated should be low, got ${aHated}`);
  assert.equal(aNeutral, 0.5);
  assert.ok(aLoved > aNeutral && aNeutral > aHated);
});

test("popNorm separates gems from mainstream", () => {
  assert.ok(popNorm(media(1, { popularity: 1000 })) < 0.3);
  assert.ok(popNorm(media(1, { popularity: 5000 })) < 0.45);
  assert.ok(popNorm(media(1, { popularity: 40000 })) > 0.6);
  assert.ok(popNorm(media(1, { popularity: 500000 })) > 0.9);
});

test("hidden gem badge: low popularity + good score + good fit", () => {
  const gem = media(1, {
    popularity: 5000,
    averageScore: 78,
    tags: [{ name: "Psychological", rank: 95, isSpoiler: false }],
    genres: ["Mystery"],
  });
  const aff = affinityOf(gem, profile).affinity01;
  const gemScore = gemScoreOf(gem, aff, qualityOf(gem));
  assert.ok(isGem(gem, gemScore), `expected gem, gemScore=${gemScore}`);
  // same fit but popular and mediocre → no gem
  const popular = media(2, { popularity: 500000, averageScore: 60, tags: gem.tags, genres: gem.genres });
  assert.ok(!isGem(popular, gemScoreOf(popular, aff, qualityOf(popular))));
});

test("scoreAll: community bonus capped, next step bonus applied, sorted by final", () => {
  const candidates = [
    media(1, { tags: [{ name: "Psychological", rank: 90, isSpoiler: false }], genres: ["Mystery"] }),
    media(2, { genres: ["Isekai"] }),
    media(3),
  ];
  const community = new Map([
    [1, 0.5], // way over cap
    [3, 0.02],
  ]);
  const franchise = new Map<number, FranchiseInfo>([
    [1, { kind: "NEXT_STEP", rootId: 1, entryPointId: null, droppedId: null }],
    [2, { kind: "STANDALONE", rootId: 2, entryPointId: null, droppedId: null }],
    [3, { kind: "STANDALONE", rootId: 3, entryPointId: null, droppedId: null }],
  ]);
  const recos = scoreAll(candidates, profile, community, franchise, "en");
  assert.equal(recos[0].media.id, 1);
  const top = recos[0];
  assert.equal(top.breakdown.community, 0.1, "community bonus must be capped at 0.1");
  assert.ok(top.badges.includes("NEXT_STEP"));
  assert.ok(top.why.length > 10);
  assert.ok(recos[0].final >= recos[1].final);
});

test("dedupeFranchises: one representative per franchise, groupSize annotated", () => {
  const recos = scoreAll(
    [media(1), media(2), media(3)],
    profile,
    new Map(),
    new Map<number, FranchiseInfo>([
      [1, { kind: "NEXT_STEP", rootId: 100, entryPointId: null, droppedId: null }],
      [2, { kind: "NEXT_STEP", rootId: 100, entryPointId: null, droppedId: null }],
      [3, { kind: "STANDALONE", rootId: 3, entryPointId: null, droppedId: null }],
    ]),
    "en",
  );
  // force media(2) to win the franchise
  recos[1].final = 0.99;
  recos.sort((a, b) => b.final - a.final);
  const deduped = dedupeFranchises(recos);
  assert.equal(deduped.length, 2);
  const franchiseRep = deduped.find((r) => r.media.id === 2);
  assert.equal(franchiseRep?.groupSize, 2);
  const standalone = deduped.find((r) => r.media.id === 3);
  assert.equal(standalone?.groupSize, 1);
});

test("franchise: dropped prequel excludes sequel (analyzeFranchises)", () => {
  const listMap = new Map<number, ListEntry>([
    [201, { mediaId: 201, status: "DROPPED", score: 0, repeat: 0, title: "S1" }],
  ]);
  const candidates = [
    media(201, { relations: [{ id: 202, relationType: "SEQUEL" }] }),
    media(202, { relations: [{ id: 201, relationType: "PREQUEL" }] }),
  ];
  const info = analyzeFranchises(candidates, listMap);
  assert.equal(info.get(202)?.kind, "EXCLUDED");
  assert.equal(info.get(202)?.droppedId, 201);
});

test("franchise: never show S3 without S1 → entry point is S1", () => {
  const candidates = [
    media(101, { relations: [{ id: 102, relationType: "SEQUEL" }] }),
    media(102, { relations: [{ id: 101, relationType: "PREQUEL" }] }),
    media(103, { relations: [{ id: 102, relationType: "PREQUEL" }] }),
  ];
  // user completed S1 only
  const listMap = new Map<number, ListEntry>([
    [101, { mediaId: 101, status: "COMPLETED", score: 90, repeat: 0, title: "S1" }],
  ]);
  const info = analyzeFranchises(candidates, listMap);
  assert.equal(info.get(102)?.kind, "NEXT_STEP", "S1 completed → S2 is the next step");
  assert.equal(info.get(103)?.kind, "ENTRY_POINT");
  // first unseen node from the root side = S2 (the user's actual next watch)
  assert.equal(info.get(103)?.entryPointId, 102);
});

test("deterministic why/whyNot: honest templates, no self-references", () => {
  const m = media(9, {
    genres: ["Isekai"],
    tags: [{ name: "Isekai", rank: 80, isSpoiler: false }],
    averageScore: 60,
    popularity: 90000,
  });
  // why: no loved overlap → neutral quality sentence, no invented claims
  const why = deterministicWhy(m, profile, [], "en");
  assert.ok(!why.includes("m9"), "why must not cite the candidate itself");
  assert.ok(why.includes("60/100"), why);
  // whyNot: shares disliked Isekai + the dropped prequel
  const franchise: FranchiseInfo = { kind: "EXCLUDED", rootId: 9, entryPointId: null, droppedId: 3 };
  const whyNot = deterministicWhyNot(m, profile, franchise, "Dropped Series S1", "en");
  assert.ok(whyNot !== null);
  assert.ok(whyNot.includes("Isekai"));
  assert.ok(whyNot.includes("Dropped Series S1"), whyNot);
  // no negative evidence at all → null (never invent a reason)
  const neutral = media(10, { genres: ["Mystery"] });
  assert.equal(deterministicWhyNot(neutral, profile, undefined, null, "en"), null);
  // why with real overlap cites the loved dim and its example titles
  const loved = media(11, { tags: [{ name: "Psychological", rank: 90, isSpoiler: false }], genres: ["Mystery"] });
  const whyLoved = deterministicWhy(loved, profile, [], "en");
  assert.ok(whyLoved.includes("Psychological"));
  assert.ok(whyLoved.includes("X"), whyLoved);
});

test("franchise: relation cycle does not hang", () => {
  const candidates = [
    media(501, { relations: [{ id: 502, relationType: "PREQUEL" }] }),
    media(502, { relations: [{ id: 501, relationType: "PREQUEL" }] }),
  ];
  const info = analyzeFranchises(candidates, new Map());
  assert.equal(info.size, 2);
  assert.ok(info.get(501));
});
