import type { Explanation, Lang, RecoResult, TasteProfile } from "../shared/types.ts";

const json = async (res: Response): Promise<any> => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
};

export const fetchHealth = (): Promise<{ ok: boolean; llm: { enabled: boolean; model: string } }> =>
  fetch("/api/health").then(json);

export const fetchProfile = (username: string): Promise<{ profile: TasteProfile }> =>
  fetch(`/api/profile/${encodeURIComponent(username)}`).then(json);

export const fetchRecommend = (username: string, lang: Lang): Promise<RecoResult> =>
  fetch("/api/recommend", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, lang }),
  }).then(json);

export const fetchExplain = (
  username: string,
  ids: number[],
  lang: Lang,
): Promise<{ explanations: (Explanation & { id: number })[] }> =>
  fetch("/api/explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, ids, lang }),
  }).then(json);
