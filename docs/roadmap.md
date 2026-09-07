# Roadmap (fuori scope v1)

- **Collaborative filtering (v2)**: dataset Turan (HF `mramazan/User-Animelist-Dataset`, 148M rating, CC-BY-4.0, 2025, include liste AniList) come segnale ibrido; join ID via anime-offline-database (frozen 2026-27, ODbL). v1 resta content-based puro.
- **OAuth AniList**: liste private + mutazioni (aggiungere alla watchlist dal sito). Client registration su anilist.co/settings/developer; niente PKCE, token 1 anno.
- **Fallback MAL/Kitsu** se AniList giù a lungo (Jikan API / Kitsu API).
- **LLM whyNot narrativo** (v1: whyNot solo deterministico) e re-ranking LLM opzionale.
- **Streaming progress** (SSE) per la prima generazione ~40-60s; oggi: due step UI + cache.
- **Manga** (AniList type: MANGA): quasi gratis, ma profilo/testi da ricontrollare.
- **i18n estesa** oltre EN/IT: file stringhe unico già predisposto.
- **SQLite** se mai serve multi-utente concorrente (oggi: filesystem cache + in-memory result cache).
