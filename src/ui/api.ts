import type { Explanation, Lang, RecoResult, SetupStatus, TasteProfile } from "../shared/types.ts";

const json = async (res: Response): Promise<any> => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
};

export const fetchHealth = (): Promise<{ ok: boolean; llm: { enabled: boolean; model: string; state?: string } }> =>
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

const isSetupStatus = (b: unknown): b is SetupStatus =>
  !!b && typeof b === "object" &&
  typeof (b as SetupStatus).setupDone === "boolean" &&
  !!(b as SetupStatus).hardware && !!(b as SetupStatus).job &&
  Array.isArray((b as SetupStatus).downloadedModels);

export const fetchSetupStatus = (): Promise<SetupStatus> =>
  fetch("/api/setup/status")
    .then(json)
    .then((b) => {
      if (!isSetupStatus(b)) throw new Error("invalid /api/setup/status payload");
      return b;
    });

/** Errors arrive as thrown Error (server code in message) — {ok:true} on success. */
export const postSetup = (
  action: "install-cli" | "download" | "finish" | "reset",
  body?: object,
): Promise<{ ok: boolean }> =>
  fetch(`/api/setup/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then(json);
