import { Hono } from "hono";
import type { Lang } from "../shared/types.ts";
import { AniListError } from "./anilist.ts";
import { llmBaseUrl, LLM_MODEL } from "./config.ts";
import { explainRecos, llmHealth } from "./llm.ts";
import { getProfile, getRecommendation } from "./recommend.ts";

const USERNAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const LANGS: ReadonlySet<string> = new Set(["en", "it"]);

export const api = new Hono();

api.get("/health", async (c) =>
  c.json({ ok: true, llm: { model: LLM_MODEL, enabled: await llmHealth() } }),
);

api.get("/config", (c) => c.json({ llm: { model: LLM_MODEL, baseUrl: llmBaseUrl() } }));

api.get("/profile/:username", async (c) => {
  const username = c.req.param("username");
  if (!USERNAME_RE.test(username)) return c.json({ error: "invalid_username" }, 400);
  try {
    return c.json({ profile: await getProfile(username) });
  } catch (e) {
    return errorResponse(c, e);
  }
});

api.post("/recommend", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { username?: string; lang?: Lang }
    | null;
  const username = body?.username ?? "";
  const lang = LANGS.has(body?.lang ?? "") ? (body!.lang as Lang) : "en";
  if (!USERNAME_RE.test(username)) return c.json({ error: "invalid_username" }, 400);
  try {
    return c.json(await getRecommendation(username, lang));
  } catch (e) {
    return errorResponse(c, e);
  }
});

api.post("/explain", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { username?: string; ids?: number[]; lang?: Lang }
    | null;
  const username = body?.username ?? "";
  const ids = new Set((body?.ids ?? []).filter((x) => typeof x === "number"));
  const lang = LANGS.has(body?.lang ?? "") ? (body!.lang as Lang) : "en";
  if (!USERNAME_RE.test(username) || ids.size === 0) return c.json({ error: "invalid_request" }, 400);
  try {
    const { recos, profile } = await getRecommendation(username, lang);
    const subset = recos.filter((r) => ids.has(r.media.id));
    const explanations = await explainRecos(subset, profile, lang, username);
    return c.json({
      explanations: [...explanations.entries()].map(([id, e]) => ({ id, ...e })),
    });
  } catch (e) {
    return errorResponse(c, e);
  }
});

function errorResponse(c: { json: (x: object, status: number) => Response }, e: unknown): Response {
  if (e instanceof AniListError) {
    if (e.status === 404) return c.json({ error: "user_not_found" }, 404);
    return c.json({ error: "anilist_error", message: e.message }, 502);
  }
  return c.json({ error: "internal_error" }, 500);
}
