# AniList Recommender

Personalized anime recommendations from your own AniList list — with explanations, hidden gems, and franchise awareness. Everything runs locally: the recommendation engine is deterministic and inspectable, and the narrative explanations come from **your own LLM server** (Ollama, LM Studio, or any OpenAI-compatible endpoint). No cloud, no accounts.

## Why this one

Every existing recommender misses at least one of these (verified 2026-09, see `docs/competitors.md`):

- **Dropped/paused as signal** — what you abandoned shapes what gets recommended *away*.
- **Franchise-aware** — never recommends S2 without S1; tells you where to start a long series; excludes series you dropped.
- **Explained picks** — a deterministic breakdown (taste / quality / community) plus optional LLM narration grounded in your real list. Also *anti-recommendations*: what to avoid and why.
- **Hidden gems** — low-popularity, high-fit titles surfaced with an explicit popularity control, not buried by it.

## Quickstart

Requires Node ≥ 22.18 and pnpm (or `corepack enable`).

```bash
pnpm install
pnpm dev
# open http://127.0.0.1:3000 and type your AniList username
```

Without an LLM the app works fine with deterministic explanations. To enable narrated explanations, start a local model server:

```bash
# Ollama
ollama serve && ollama pull qwen3:8b
# or LM Studio (set LLM_BASE_URL=http://127.0.0.1:1234/v1 in .env — see .env.example)
```

Language: English by default, Italiano via the toggle (covers UI strings and explanation language).

## Offline mode / tests

```bash
pnpm test                                  # unit + API smoke tests on synthetic fixtures
ANILIST_FIXTURES=fixtures pnpm dev         # run the app without touching AniList
pnpm record-fixtures <username>            # record your real list as fixtures (API must be up)
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/health` | `{ok, llm: {enabled, model}}` |
| `GET /api/profile/:username` | taste profile (loved/disliked tags, genres, studios, eras) |
| `POST /api/recommend {username, lang}` | `{profile, recos[≤50], avoided[≤3]}` |
| `POST /api/explain {username, ids, lang}` | LLM (or fallback) explanations for given media ids |

## How scoring works

Deterministic, all weights in `src/server/config.ts` (`WEIGHTS`), full math in `docs/architecture.md`:

```
sentiment(entry) = clamp(statusBase + (score − yourMean)/40 + repeatBonus)
profile          = loved/disliked per tag·rank, genre, studio, era (support-shrunk)
affinity(cand)   = 0.50·tags + 0.30·genres + 0.12·studio + 0.08·era   → [0,1]
final            = 0.60·affinity + 0.28·quality + community + 0.12·nextStep
hidden gem       = popularity < 40k ∧ AniList ≥ 72 ∧ gemScore ≥ 0.45  (gemScore penalizes popularity)
```

Dropped entries push their tags/genres/studios into your *disliked* profile; a dropped prequel excludes the whole sequel chain.

## AniList compliance

Reads only public lists and runs ~20 targeted GraphQL queries per lookup (never a catalog mirror), cached on disk with short TTLs — within AniList's API terms of use. See `docs/anilist-api.md`.

## Docs

`docs/README.md` is the index: decisions, architecture, competitor analysis, API facts, plan status, roadmap.

## License

MIT
