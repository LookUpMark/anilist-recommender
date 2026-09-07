import type { Lang, RecoResult, WhyNot } from "../shared/types.ts";
import { fetchCandidates } from "./candidates.ts";
import { fetchMediaByIds, fetchRecommendations, fetchUserList } from "./anilist.ts";
import { buildProfile, entrySentiment } from "./profile.ts";
import { analyzeFranchises } from "./franchise.ts";
import { dedupeFranchises, deterministicWhyNot, scoreAll } from "./scoring.ts";
import { WEIGHTS } from "./config.ts";

// in-memory result cache: profile+pool are the expensive part; explain() reuses it
const resultCache = new Map<string, { at: number; result: RecoResult }>();
const RESULT_TTL_MS = 10 * 60 * 1000;

/** Cheap: list fetch (disk-cached 1h) + profile build. No candidate pool. */
export async function getProfile(username: string) {
  const { entries, mediaById } = await fetchUserList(username);
  return buildProfile(entries, mediaById, username);
}

export async function getRecommendation(
  username: string,
  lang: Lang,
  opts: { refresh?: boolean } = {},
): Promise<RecoResult> {
  const cacheKey = `${username}:${lang}`;
  if (!opts.refresh) {
    const hit = resultCache.get(cacheKey);
    if (hit && Date.now() - hit.at < RESULT_TTL_MS) return hit.result;
  }
  const result = await recommendFor(username, lang, opts);
  resultCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

async function recommendFor(
  username: string,
  lang: Lang,
  opts: { refresh?: boolean },
): Promise<RecoResult> {
  const { entries, mediaById } = await fetchUserList(username);
  const profile = buildProfile(entries, mediaById, username);
  const listIds = new Set(entries.map((e) => e.mediaId));
  const listMap = new Map(entries.map((e) => [e.mediaId, e]));

  // 1st franchise pass: sequel chains collapse to their entry point.
  // epMap: entryPointId → superseded candidate (the sequel shown instead must go).
  const candidates0 = await fetchCandidates(profile, listIds);
  const franchise0 = analyzeFranchises(candidates0, listMap);
  const epMap = new Map<number, number>();
  const skipped = new Set<number>();
  for (const [id, f] of franchise0) {
    if (f.kind !== "ENTRY_POINT" || f.entryPointId == null || f.entryPointId === id) continue;
    if (listMap.get(f.entryPointId)?.status === "PLANNING") {
      skipped.add(id); // already planned the right entry — say nothing
      continue;
    }
    epMap.set(f.entryPointId, id);
  }
  const missingEntries = [...epMap.keys()].filter(
    (id) => !candidates0.some((c) => c.id === id) && !listIds.has(id),
  );
  const extra = await fetchMediaByIds(missingEntries);
  const superseded = new Set(epMap.values());
  const candidates = [
    ...candidates0.filter((c) => !superseded.has(c.id) && !skipped.has(c.id)),
    ...extra.filter((m) => !candidates0.some((c) => c.id === m.id)),
  ];
  const franchise = analyzeFranchises(candidates, listMap);
  // an entry point pulled in for a superseded sequel earns the badge unless
  // its own analysis already classified it (NEXT_STEP when its prequels are seen)
  for (const [epId] of epMap) {
    const f = franchise.get(epId);
    if (f?.kind === "STANDALONE") {
      franchise.set(epId, { ...f, kind: "ENTRY_POINT", entryPointId: epId });
    }
  }

  // community signal: recommendation graph of the user's top-5 rated entries
  const community = new Map<number, number>();
  const top5 = [...entries]
    .map((e) => ({ e, s: entrySentiment(e, profile.meanScore).s }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  const recLists = await Promise.all(top5.map(({ e }) => fetchRecommendations(e.mediaId).catch(() => [])));
  for (const recs of recLists) {
    for (const { targetId, rating } of recs) {
      if (rating <= 0 || !candidates.some((c) => c.id === targetId)) continue;
      community.set(
        targetId,
        Math.min(WEIGHTS.communityCap, (community.get(targetId) ?? 0) + WEIGHTS.communityPerHit),
      );
    }
  }

  const scored = scoreAll(
    candidates.filter((c) => franchise.get(c.id)?.kind !== "EXCLUDED"),
    profile,
    community,
    franchise,
    lang,
  );
  const deduped = dedupeFranchises(scored).slice(0, 50);
  // the entry point card stands in for the whole sequel chain
  for (const r of deduped) {
    const orig = epMap.get(r.media.id);
    const origInfo = orig != null ? franchise.get(orig) : undefined;
    if (origInfo) r.rootId = origInfo.rootId;
  }
  const withGroups = dedupeFranchises(deduped);

  // anti-recommendations: weakest affinity candidates with honest negative evidence,
  // never duplicating something already recommended
  const shownIds = new Set(withGroups.map((r) => r.media.id));
  const bottom = [...scored]
    .filter((r) => !shownIds.has(r.media.id))
    .sort((a, b) => a.breakdown.affinity - b.breakdown.affinity)
    .slice(0, 12);
  const avoided: WhyNot[] = [];
  for (const r of bottom) {
    const f = franchise.get(r.media.id);
    const droppedTitle = f?.droppedId != null ? (listMap.get(f.droppedId)?.title ?? null) : null;
    const reason = deterministicWhyNot(r.media, profile, f, droppedTitle, lang);
    if (reason) avoided.push({ media: r.media, reason });
    if (avoided.length >= 3) break;
  }

  return { profile, recos: withGroups, avoided };
}
