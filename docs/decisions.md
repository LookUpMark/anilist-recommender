# Decisioni (2026-09-07, con Marco)

| # | Decisione | Motivazione |
|---|---|---|
| 1 | Pubblico: chiunque con account AniList | Massimo appeal; OAuth non richiesto in v1 |
| 2 | Distribuzione: OSS self-hosted (MIT) | "Interamente locale": chi clona usa il proprio Ollama/LM Studio; nessun server sempre acceso, zero costi |
| 3 | Accesso: solo username AniList, NO OAuth | Liste pubbliche sono il default su AniList; OAuth rinvia a v2 |
| 4 | Motore: content-based deterministico + LLM locale per spiegazioni | Trasparente, spiegabile, gira tutto in locale; degrado grazioso a LLM spento |
| 5 | Endpoint LLM: OpenAI-compatibile (default Ollama 11434/v1, LM Studio 1234/v1) | Nessuna cloud API a pagamento |
| 6 | Punti di forza: spiegazioni perché/ perché NON, hidden gems, franchise-aware, UI curata | Ciascuno è un gap verificato dei competitor (vedi competitors.md) |
| 7 | Lingua: inglese default, italiano opzionale (toggle UI che copre stringhe UI + lingua spiegazioni LLM) | Richiesta esplicita Marco |
| 8 | v1 solo API AniList, zero dataset esterni | CF su dataset Turan rinvia a v2 (roadmap.md) |
| 9 | Stack: Node ≥22.18 + TypeScript (type stripping nativo), Hono, Vite+React stesso processo, node:test, pnpm | Zero deps superflue, un solo comando dev; ecosistema Node di Marco |
| 10 | Persistenza: solo filesystem (data/cache/) | No DB; SQLite solo se serve multi-utente concorrente |
| 11 | Dev/test offline via fixtures/ registrate | API AniList instabile (30 req/min, outage 2026-09-07) |
| 12 | Commit firmati solo Marco, mai co-author AI; push solo su richiesta | Regola stabile dell'utente |
