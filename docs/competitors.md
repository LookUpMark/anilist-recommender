# Competitor e posizionamento (ricerca verificata 2026-09-07)

## Esistenti

| Progetto | URL | Approccio | Stato | Debolezza |
|---|---|---|---|---|
| RecoSensei | recosensei.com | Import MAL/AniList → profilo archetipo, For You / Hidden Gems, spiegazioni "because you liked" | Attivo (© 2026), closed source | Spiegazioni generiche a tratti; algoritmo opaco; niente dropped/franchise |
| Sprout | anime.ameo.dev, github.com/Ameobea/sprout | NN ~100M param (autoencoder denoising) su intero profilo MAL+AniList | Attivo (push 2026-08, 103★) | Opaco (spiegabilità debole); single-maintainer |
| Kanshi | github.com/u-Kuro/Kanshi-Anime-Recommender | Content-based (generi+tag) + regressioni trend | Attivo (push 2026-07, 37★) | Penalizza NICCHIE (bias popolarità), dropped non gestiti |
| AlimU11/Anime-Recommender | github | content-based AniList | Abbandonato (2023) | Richiede score su tutti i titoli |
| AniList/MAL/Anime-Planet nativi | — | Coppie community user-submitted, o suggerimenti solo per chi traccia sul sito | — | Zero personalizzazione algoritmica su lista importata |

## Gap verificati non coperti da nessuno = posizionamento del progetto

1. **DROPPED/PAUSED come segnale negativo** nel profiling (nessuno li usa; Sprout usa solo score bassi)
2. **Logica franchise**: mai consigliare S2 senza S1, entry point corretto, "prossimo passo", dropped → serie esclusa
3. **Spiegazioni LLM narrative fondate sulla lista reale** + anti-raccomandazioni "perché NON" (RecoSensei: tratti fissi; Sprout: omissione rating)
4. **Hidden gems con popularity bias controllato esplicitamente** (gemScore − 0.30·popNorm; Kanshi fa l'opposto)
5. **OSS con LLM locale, zero cloud** (RecoSensei closed, Sprout cloud NN)

## Verdetto

L'idea è già parzialmente coperta (RecoSensei è il benchmark) ma i 5 gap sono reali e dimostrabili: il progetto si posiziona lì. Vantaggio ulteriore: spiegabilità totale (breakdown affinità/qualità/community per ogni card) e self-hosted.
