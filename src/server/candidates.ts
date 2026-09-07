import type { MediaLite, TasteProfile } from "../shared/types.ts";
import { fetchMediaPage } from "./anilist.ts";

const top = (p: TasteProfile, dim: string, n: number): string[] =>
  p.loved
    .filter((d) => d.dim === dim)
    .slice(0, n)
    .map((d) => d.value);

/**
 * Candidate pool from targeted queries only (AniList ToS forbids catalog mirrors):
 * top-3 loved genres x 2 pages popularity, top-5 loved tags x 1 page (rank>=60),
 * top-2 loved genres x 2 pages by score (gem pool). ~13 requests.
 */
export async function fetchCandidates(
  profile: TasteProfile,
  excludeIds: Set<number>,
): Promise<MediaLite[]> {
  const genres = top(profile, "genre", 3);
  const tags = top(profile, "tag", 5);
  const queries: Parameters<typeof fetchMediaPage>[0][] = [];
  for (const g of genres.slice(0, 2)) {
    queries.push({ genres: [g], sort: ["POPULARITY_DESC"], page: 1 });
    queries.push({ genres: [g], sort: ["POPULARITY_DESC"], page: 2 });
  }
  for (const t of tags) {
    queries.push({ tags: [t], minimumTagRank: 60, sort: ["POPULARITY_DESC"], page: 1 });
  }
  for (const g of genres.slice(0, 2)) {
    queries.push({ genres: [g], sort: ["SCORE_DESC"], page: 1 });
  }
  // cold-start fallback: global popularity pages
  if (queries.length === 0) {
    queries.push({ sort: ["POPULARITY_DESC"], page: 1 });
    queries.push({ sort: ["POPULARITY_DESC"], page: 2 });
  }

  const pool = new Map<number, MediaLite>();
  const results = await Promise.all(queries.map((q) => fetchMediaPage(q).catch(() => ({ media: [], hasNextPage: false }))));
  for (const { media } of results) {
    for (const m of media) {
      if (!excludeIds.has(m.id) && !pool.has(m.id)) pool.set(m.id, m);
    }
  }
  return [...pool.values()];
}
