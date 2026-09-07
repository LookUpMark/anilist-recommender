import type { Explanation, Lang, RecoResult, SetupStatus, TasteProfile } from "../shared/types.ts";

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

export const fetchSetupStatus = (): Promise<SetupStatus> =>
  fetch("/api/setup/status").then(json);

export const postSetup = (
  action: "install-cli" | "download" | "finish" | "reset",
  body?: object,
): Promise<{ ok?: boolean; error?: string }> =>
  fetch(`/api/setup/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then(json);
