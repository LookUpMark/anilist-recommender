# Piano di implementazione e stato

Riprendere il progetto: leggere `docs/README.md` → `decisions.md` → `architecture.md`, poi la tabella qui sotto. Ogni milestone ha DoD verificabile.

## Milestone

| M | Contenuto | DoD | Stato |
|---|---|---|---|
| M0 | Scaffold: pnpm+TS+Vite+Hono, /api/health, CI, LICENSE, README | `pnpm dev` → pagina + health 200; CI verde | ✅ |
| M1 | Profilo gusti: `record-fixtures.mjs`, `anilist.ts`, `profile.ts`, GET /api/profile, UsernameForm+ProfilePanel, test profilo | Profilo generato offline da fixture; UI mostra amati/odiati; `pnpm test` verde | ✅ |
| M2 | Motore deterministico: `candidates.ts`, `scoring.ts`, `franchise.ts`, `recommend.ts`, POST /api/recommend, RecoCard/griglia/filtri, test scoring+franchise | Recos complete SENZA LLM con why deterministico; test: S3 senza S1 → entry point; dropped S1 esclude S2; badge gem sotto 40k pop | ✅ |
| M3 | Layer LLM: `llm.ts`, POST /api/explain, cache spiegazioni, whyNot | Con Ollama attivo: spiegazioni su top-10; LLM irraggiungibile → fallback senza errori (test automatico); seconda richiesta identica → cache | ✅ |
| M4 | Rifinitura: toggle lingua EN (default)/IT, gems view, dedupe franchise espandibile, stati vuoto/errore, CSS, ui-ux-audit, README quickstart | Audit senza P0; quickstart clone → rec in ≤5 comandi | ✅ (audit statico 0 FAIL; verifica visiva browser da fare con API reale) |
| M5 | Hardening: e2e vs API reale, liste >1k, utente senza score, 429 reale, edge fixture (lista vuota, 1 entry, zero score), tag v1.0.0 | Checklist e2e documentata; nessun crash su edge | ⬜ bloccata su API AniList stabile / username reale per fixtures |

## Come verificare

```bash
pnpm install
pnpm typecheck && pnpm test     # unit + smoke API su fixture
ANILIST_FIXTURES=fixtures pnpm dev   # app offline su fixture sintetiche
# API reale (quando AniList è su): pnpm dev, poi inserire uno username
```

## Aperti

- Registrare fixtures reali: `pnpm record-fixtures <username-anilist>` (serve username di Marco; API deve essere raggiungibile)
- Release v1.0.0 dopo M5 (commit solo a nome Marco, push su richiesta)
