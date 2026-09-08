import { useEffect, useMemo, useRef, useState } from "react";
import { tr, type Lang } from "../shared/strings.ts";
import type { RecoResult, ScoredReco, SetupStatus } from "../shared/types.ts";
import {
  fetchAppUpdate,
  fetchExplain,
  fetchHealth,
  fetchProfile,
  fetchRecommend,
  fetchSetupStatus,
  postLocalMode,
  type AppUpdate,
  type LocalMode,
} from "./api.ts";
import { AvoidList } from "./components/AvoidList.tsx";
import { Carousel } from "./components/Carousel.tsx";
import { DetailDialog } from "./components/DetailDialog.tsx";
import { Hero } from "./components/Hero.tsx";
import { MediaCard } from "./components/MediaCard.tsx";
import { ProfileView } from "./components/ProfileView.tsx";
import { Rail } from "./components/Rail.tsx";
import { SetupWizard } from "./components/SetupWizard.tsx";
import { Topbar } from "./components/Topbar.tsx";
import type { View } from "./views.ts";

type SortKey = "final" | "gem" | "affinity";

const VIEW_ORDER: View[] = ["home", "recos", "gems", "profile", "avoid"];
const gemRank = (r: ScoredReco): number =>
  r.badges.includes("HIDDEN_GEM")
    ? r.breakdown.affinity - r.media.popularity / 1_000_000
    : Number.NEGATIVE_INFINITY; // outside the value domain — no config coupling

export function App() {
  const [lang, setLang] = useState<Lang>(
    localStorage.getItem("lang") === "it" ? "it" : "en", // validate, never cast
  );
  const [view, setView] = useState<View>(() => {
    const v = localStorage.getItem("alr-view");
    return VIEW_ORDER.includes(v as View) ? (v as View) : "home";
  });
  const [setup, setSetup] = useState<SetupStatus | null | "error">(null);
  const [llmOn, setLlmOn] = useState<boolean | null>(null);
  const [local, setLocal] = useState<LocalMode | null>(null);
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [phase, setPhase] = useState<"idle" | "profile" | "recos">("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [result, setResult] = useState<RecoResult | null>(null);
  const [whySource, setWhySource] = useState<Record<number, "llm" | "local">>({});
  const [sort, setSort] = useState<SortKey>("final");
  const [gemsOnly, setGemsOnly] = useState(false);
  const [format, setFormat] = useState("all");
  const [genre, setGenre] = useState("all");
  const [dialog, setDialog] = useState<ScoredReco | null>(null);
  const lastView = useRef<View>("recos");

  useEffect(() => {
    fetchSetupStatus().then(setSetup).catch(() => setSetup("error"));
  }, []);

  useEffect(() => {
    localStorage.setItem("lang", lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const showView = (v: View) => {
    if (v !== "home") lastView.current = v;
    setView(v);
    localStorage.setItem("alr-view", v);
  };

  const refreshHealth = () => {
    fetchHealth()
      .then((h) => {
        setLlmOn(h.llm.enabled);
        setLocal(h.local);
      })
      .catch(() => setLlmOn(false));
  };

  useEffect(refreshHealth, []);

  // update check: server injects APP_VERSION only when packaged
  useEffect(() => {
    fetchAppUpdate().then(setUpdate).catch(() => undefined);
  }, []);

  // the top scrim under the sticky topbar lights up once the page scrolls
  useEffect(() => {
    const el = document.getElementById("top-fade");
    const onScroll = () => el?.classList.toggle("on", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const errorMessage = (e: unknown): string =>
    e instanceof Error && e.message === "user_not_found"
      ? tr(lang, "errUserNotFound")
      : e instanceof Error && e.message === "anilist_error"
        ? tr(lang, "errAnilistDown")
        : tr(lang, "errGeneric");

  async function run(username: string) {
    setUsername(username);
    setError(null);
    setResult(null);
    setGenre("all");
    setPhase("profile");
    setLoading(true);
    showView("recos");
    try {
      await fetchProfile(username);
      const r = await fetchRecommend(username, lang);
      setResult(r);
      setPhase("recos");
      // upgrade deterministic whys with LLM narrations, in the background
      fetchExplain(username, r.recos.slice(0, 10).map((x) => x.media.id), lang)
        .then((ex) => {
          const byId = new Map(ex.explanations.map((x) => [x.id, x]));
          setWhySource(Object.fromEntries([...byId].map(([id, x]) => [id, x.source === "fallback" ? "local" : "llm"])));
          setResult((cur) =>
            cur
              ? {
                  ...cur,
                  recos: cur.recos.map((x) => {
                    const e = byId.get(x.media.id);
                    return e ? { ...x, why: e.text } : x;
                  }),
                }
              : cur,
          );
        })
        .catch(() => undefined);
    } catch (e) {
      setError(errorMessage(e));
      setPhase("idle");
    } finally {
      setLoading(false);
      refreshHealth(); // the server may have auto-switched to local mode mid-request
    }
  }

  const recos = useMemo(() => {
    if (!result) return [];
    let list = result.recos;
    if (gemsOnly) list = list.filter((r) => r.badges.includes("HIDDEN_GEM"));
    if (format !== "all") list = list.filter((r) => r.media.format === format);
    if (genre !== "all") list = list.filter((r) => r.media.genres.includes(genre));
    const sorted = [...list];
    if (sort === "gem") sorted.sort((a, b) => gemRank(b) - gemRank(a));
    else if (sort === "affinity") sorted.sort((a, b) => b.breakdown.affinity - a.breakdown.affinity);
    else sorted.sort((a, b) => b.final - a.final);
    return sorted;
  }, [result, gemsOnly, format, genre, sort]);

  const topPicks = useMemo(() => (result ? [...result.recos].sort((a, b) => b.final - a.final) : []), [result]);
  const gems = useMemo(
    () =>
      result
        ? result.recos.filter((r) => r.badges.includes("HIDDEN_GEM")).sort((a, b) => b.breakdown.affinity - a.breakdown.affinity)
        : [],
    [result],
  );
  const genres = useMemo(() => {
    if (!result) return [];
    const freq = new Map<string, number>();
    for (const r of result.recos) for (const g of r.media.genres) freq.set(g, (freq.get(g) ?? 0) + 1);
    return [...freq].sort((a, b) => b[1] - a[1]).slice(0, 9).map(([g]) => g);
  }, [result]);
  const formats = useMemo(
    () => [...new Set((result?.recos ?? []).map((r) => r.media.format).filter(Boolean))] as string[],
    [result],
  );

  const resetFilters = () => {
    setSort("final");
    setGemsOnly(false);
    setFormat("all");
    setGenre("all");
  };
  const filtersActive = gemsOnly || format !== "all" || genre !== "all";

  if (setup === "error") {
    return (
      <main className="setup-error">
        <h1>{tr(lang, "appName")}</h1>
        <p className="error">{tr(lang, "errGeneric")}</p>
        <button className="btn btn-primary" type="button" onClick={() => fetchSetupStatus().then(setSetup).catch(() => setSetup("error"))}>
          {tr(lang, "go")}
        </button>
      </main>
    );
  }

  if (setup && !setup.setupDone && !setup.customEnv) {
    return (
      <SetupWizard
        lang={lang}
        setLang={setLang}
        initial={setup}
        onDone={() => setSetup({ ...setup, setupDone: true })}
      />
    );
  }

  const hero = topPicks[0] ?? null;

  return (
    <>
      <div className="glow" aria-hidden="true" />
      <div className="top-fade" id="top-fade" aria-hidden="true" />
      <div className="shell" data-od-id="app-shell">
        <Rail
          view={view}
          lang={lang}
          llmOn={llmOn}
          local={local}
          onToggleLocal={() => {
            if (!local) return;
            postLocalMode(!local.auto).then((r) => setLocal(r.local)).catch(() => undefined);
          }}
          update={update}
          onCheckUpdates={() => fetchAppUpdate().then(setUpdate).catch(() => undefined)}
          onNav={showView}
          onLang={() => setLang(lang === "en" ? "it" : "en")}
        />

        <div className="main">
          <Topbar
            view={view}
            lang={lang}
            user={result?.profile.userName ?? username}
            busy={loading}
            onLang={() => setLang(lang === "en" ? "it" : "en")}
            onProfile={() => showView("profile")}
            onSubmit={run}
          />

          {error && (
            <div className="error-box" role="alert" data-od-id="error-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5.5M12 16.4v.2" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {local?.on && (
            <div className="error-box local-banner" role="status" data-od-id="local-banner">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M12 9v4.5M12 16.6v.2" />
                <path d="M10.3 4.6 3.6 18a1.6 1.6 0 0 0 1.4 2.4h14a1.6 1.6 0 0 0 1.4-2.4L13.7 4.6a1.6 1.6 0 0 0-2.8 0z" />
              </svg>
              <span>{tr(lang, "localBanner")}</span>
              <button
                type="button"
                className="linklike"
                disabled={loading}
                onClick={() => {
                  postLocalMode(true, false)
                    .then((r) => setLocal(r.local))
                    .catch(() => undefined);
                  void run(username);
                }}
              >
                {tr(lang, "retryLive")}
              </button>
            </div>
          )}

          {/* ── HOME ── */}
          <section className="view" id="view-home" data-od-id="view-home" aria-label={tr(lang, "navHome")} hidden={view !== "home"}>
            {hero && result ? (
              <>
                <Hero reco={hero} lang={lang} user={result.profile.userName} onOpen={setDialog} onAll={() => showView("recos")} />
                <div className="sec-head">
                  <h2>{tr(lang, "sectionPicks")}</h2>
                  <button className="more" type="button" onClick={() => showView("recos")}>{tr(lang, "seeAll")}</button>
                </div>
                <Carousel label={tr(lang, "sectionPicks")} prev={tr(lang, "carPrev")} next={tr(lang, "carNext")}>
                  {topPicks.slice(0, 8).map((r) => (
                    <MediaCard key={r.media.id} reco={r} lang={lang} eager onOpen={setDialog} />
                  ))}
                </Carousel>
                {genres.length > 0 && (
                  <div className="genre-row" data-od-id="genre-row">
                    {genres.map((g) => (
                      <button
                        key={g}
                        type="button"
                        className="genre-chip"
                        aria-pressed={genre === g}
                        onClick={() => {
                          setGenre(genre === g ? "all" : g);
                          showView("recos");
                        }}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                )}
                <div className="stats" data-od-id="stats-row">
                  <div className="stat"><div className="num">{result.profile.meanScore}</div><div className="lbl">{tr(lang, "statMean", { n: result.profile.scoredCount })}</div></div>
                  <div className="stat"><div className="num">{result.profile.counts.COMPLETED}</div><div className="lbl">{tr(lang, "statDone")}</div></div>
                  <div className="stat"><div className="num">{gems.length}</div><div className="lbl">{tr(lang, "statGems")}</div></div>
                  <div className="stat"><div className="num">{Math.round(hero.final * 100)}<small>/110</small></div><div className="lbl">{tr(lang, "statTop")}</div></div>
                </div>
              </>
            ) : (
              <div className="state-box" data-od-id="home-empty">
                <p className="big">{tr(lang, "appName")}</p>
                <p>{tr(lang, "tagline")}</p>
              </div>
            )}
          </section>

          {/* ── CONSIGLI ── */}
          <section className="view" id="view-recos" data-od-id="view-recos" aria-label={tr(lang, "navRecos")} hidden={view !== "recos"}>
            {loading && !result ? (
              <div className="skeleton" aria-hidden="true">
                {Array.from({ length: 10 }, (_, i) => (
                  <div className="sk" key={i}>
                    <div className="ph" />
                    <div className="ln" />
                    <div className="ln s" />
                  </div>
                ))}
              </div>
            ) : phase === "profile" ? (
              <p className="loading">{tr(lang, "loadingProfile")}</p>
            ) : (
              result && (
                <>
                  <div className="toolbar" data-od-id="toolbar-recos">
                    <div className="seg" role="group" aria-label={tr(lang, "sortFinal")}>
                      {(["final", "gem", "affinity"] as SortKey[]).map((k) => (
                        <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>
                          {tr(lang, k === "final" ? "sortFinal" : k === "gem" ? "sortGem" : "sortAffinity")}
                        </button>
                      ))}
                    </div>
                    <div className="seg" role="group" aria-label={tr(lang, "fmtAll")}>
                      <button type="button" aria-pressed={format === "all"} onClick={() => setFormat("all")}>{tr(lang, "fmtAll")}</button>
                      {formats.map((f) => (
                        <button key={f} type="button" aria-pressed={format === f} onClick={() => setFormat(f)}>
                          {f === "MOVIE" ? tr(lang, "fmtMovie") : f}
                        </button>
                      ))}
                    </div>
                    <div className="seg" role="group" aria-label={tr(lang, "gemsOnly")}>
                      <button type="button" aria-pressed={!gemsOnly} onClick={() => setGemsOnly(false)}>{tr(lang, "gemsOff")}</button>
                      <button type="button" aria-pressed={gemsOnly} onClick={() => setGemsOnly(true)}>{tr(lang, "gemsOnly")}</button>
                    </div>
                    {genre !== "all" && (
                      <button type="button" className="genre-chip" aria-pressed="true" onClick={() => setGenre("all")}>
                        {tr(lang, "genreFilterOn", { g: genre })}
                      </button>
                    )}
                    <span className="spacer" />
                    <span className="count-lbl mono">{tr(lang, "resultsLbl", { n: recos.length })}</span>
                  </div>

                  {recos.length > 0 ? (
                    <div className="grid" data-od-id="recos-grid">
                      {recos.map((r, i) => (
                        <MediaCard key={r.media.id} reco={r} lang={lang} eager={i < 6} onOpen={setDialog} />
                      ))}
                    </div>
                  ) : (
                    <div className="state-box" data-od-id="recos-empty">
                      <p className="big">{tr(lang, "emptyBig")}</p>
                      <p>{tr(lang, "emptySub")}</p>
                      {filtersActive && (
                        <button className="more" type="button" onClick={resetFilters}>{tr(lang, "resetFilters")}</button>
                      )}
                    </div>
                  )}
                </>
              )
            )}
          </section>

          {/* ── GEMME ── */}
          <section className="view" id="view-gems" data-od-id="view-gems" aria-label={tr(lang, "navGems")} hidden={view !== "gems"}>
            <div className="sec-head" style={{ marginTop: 0 }}>
              <div>
                <h2>{tr(lang, "gemsTitle")}</h2>
                <p>{tr(lang, "gemsSub")}</p>
              </div>
            </div>
            {gems.length > 0 ? (
              <div className="grid" data-od-id="gems-grid">
                {gems.map((r, i) => (
                  <MediaCard key={r.media.id} reco={r} lang={lang} eager={i < 6} onOpen={setDialog} />
                ))}
              </div>
            ) : (
              <div className="state-box"><p>{loading ? tr(lang, "loadingRecos") : tr(lang, "emptyState")}</p></div>
            )}
          </section>

          {/* ── PROFILO ── */}
          <section className="view" id="view-profile" data-od-id="view-profile" aria-label={tr(lang, "navProfile")} hidden={view !== "profile"}>
            {result ? (
              <>
                <div className="sec-head" style={{ marginTop: 0 }}>
                  <div>
                    <h2>{tr(lang, "profTitle")}</h2>
                    <p>{tr(lang, "profSub")}</p>
                  </div>
                  <span className={`conf${result.profile.confidence === "low" ? " low" : ""}`}>
                    <span className="dot" aria-hidden="true" />
                    {tr(lang, result.profile.confidence === "ok" ? "confOk" : "confidenceLow")}
                  </span>
                </div>
                <ProfileView profile={result.profile} lang={lang} />
              </>
            ) : (
              <div className="state-box"><p>{tr(lang, "emptyState")}</p></div>
            )}
          </section>

          {/* ── EVITA ── */}
          <section className="view" id="view-avoid" data-od-id="view-avoid" aria-label={tr(lang, "navAvoid")} hidden={view !== "avoid"}>
            <div className="sec-head" style={{ marginTop: 0 }}>
              <div>
                <h2>{tr(lang, "avoidTitle")}</h2>
                <p>{tr(lang, "avoidSub")}</p>
              </div>
            </div>
            {result && result.avoided.length > 0 ? (
              <AvoidList items={result.avoided} lang={lang} />
            ) : (
              <div className="state-box"><p>{tr(lang, "emptyState")}</p></div>
            )}
          </section>

          <footer className="pagefoot" data-od-id="footer">
            <span>{tr(lang, "apiHint")}</span>
            <span className="mono">anilist.co</span>
          </footer>
        </div>
      </div>

      {dialog && (
        <DetailDialog
          reco={dialog}
          lang={lang}
          whySource={whySource[dialog.media.id] ?? "local"}
          onClose={() => setDialog(null)}
          onSimilar={() => {
            setDialog(null);
            setSort("affinity");
            showView(lastView.current);
          }}
        />
      )}
    </>
  );
}
