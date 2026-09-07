import { useEffect, useMemo, useState } from "react";
import { tr, type Lang } from "../shared/strings.ts";
import type { RecoResult, SetupStatus, TasteProfile } from "../shared/types.ts";
import { fetchExplain, fetchHealth, fetchProfile, fetchRecommend, fetchSetupStatus } from "./api.ts";
import { ProfilePanel } from "./components/ProfilePanel.tsx";
import { RecoCard } from "./components/RecoCard.tsx";
import { SetupWizard } from "./components/SetupWizard.tsx";
import { UsernameForm } from "./components/UsernameForm.tsx";

type Phase = "idle" | "profile" | "recos";
type SortKey = "final" | "gem" | "affinity";

const gemRank = (r: RecoResult["recos"][number]): number =>
  r.badges.includes("HIDDEN_GEM")
    ? r.breakdown.affinity - r.media.popularity / 1_000_000
    : -1;

export function App() {
  const [lang, setLang] = useState<Lang>(
    (localStorage.getItem("lang") as Lang | null) ?? "en",
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TasteProfile | null>(null);
  const [result, setResult] = useState<RecoResult | null>(null);
  const [llmOn, setLlmOn] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [sort, setSort] = useState<SortKey>("final");
  const [gemsOnly, setGemsOnly] = useState(false);
  const [format, setFormat] = useState("all");
  const [setup, setSetup] = useState<SetupStatus | null>(null);

  useEffect(() => {
    fetchSetupStatus()
      .then(setSetup)
      .catch(() => setSetup(null));
  }, []);

  useEffect(() => {
    localStorage.setItem("lang", lang);
  }, [lang]);

  useEffect(() => {
    fetchHealth()
      .then((h) => setLlmOn(h.llm.enabled))
      .catch(() => setLlmOn(false));
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
    setPhase("profile");
    try {
      const p = await fetchProfile(username);
      setProfile(p.profile);
      const r = await fetchRecommend(username, lang);
      setResult(r);
      setPhase("recos");
      // upgrade deterministic whys with LLM narrations, in the background
      fetchExplain(username, r.recos.slice(0, 10).map((x) => x.media.id), lang)
        .then((ex) => {
          const byId = new Map(ex.explanations.map((x) => [x.id, x]));
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
    }
  }

  const recos = useMemo(() => {
    if (!result) return [];
    let list = result.recos;
    if (gemsOnly) list = list.filter((r) => r.badges.includes("HIDDEN_GEM"));
    if (format !== "all") list = list.filter((r) => r.media.format === format);
    const sorted = [...list];
    if (sort === "gem") sorted.sort((a, b) => gemRank(b) - gemRank(a));
    else if (sort === "affinity") sorted.sort((a, b) => b.breakdown.affinity - a.breakdown.affinity);
    else sorted.sort((a, b) => b.final - a.final);
    return sorted;
  }, [result, gemsOnly, format, sort]);

  const formats = useMemo(
    () => [...new Set((result?.recos ?? []).map((r) => r.media.format).filter(Boolean))] as string[],
    [result],
  );

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

  return (
    <main className="app">
      <header>
        <div>
          <h1>{tr(lang, "appName")}</h1>
          <p className="tagline">{tr(lang, "tagline")}</p>
        </div>
        <div className="header-side">
          {llmOn != null && (
            <span className={`chip ${llmOn ? "ok" : "warn"}`}>
              {llmOn ? tr(lang, "llmOn") : tr(lang, "llmOff")}
            </span>
          )}
          <button className="lang" onClick={() => setLang(lang === "en" ? "it" : "en")}>
            {tr(lang, "langToggle")}
          </button>
        </div>
      </header>

      <UsernameForm lang={lang} busy={phase === "profile" || phase === "recos"} onSubmit={run} />
      <p className="hint">{tr(lang, "apiHint")}</p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {phase === "profile" && <p className="loading">{tr(lang, "loadingProfile")}</p>}
      {phase === "recos" && !result && <p className="loading">{tr(lang, "loadingRecos")}</p>}

      {profile && (
        <ProfilePanel profile={profile} lang={lang} />
      )}

      {result && result.recos.length === 0 && <p className="empty">{tr(lang, "emptyState")}</p>}

      {result && result.recos.length > 0 && (
        <>
          <div className="toolbar">
            <h2>{tr(lang, "recommendations")}</h2>
            <label>
              <input type="checkbox" checked={gemsOnly} onChange={(e) => setGemsOnly(e.target.checked)} />
              {tr(lang, "gemsOnly")}
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="sort">
              <option value="final">{tr(lang, "sortFinal")}</option>
              <option value="gem">{tr(lang, "sortGem")}</option>
              <option value="affinity">{tr(lang, "sortAffinity")}</option>
            </select>
            <select value={format} onChange={(e) => setFormat(e.target.value)} aria-label="format">
              <option value="all">{tr(lang, "allFormats")}</option>
              {formats.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="grid">
            {recos.map((r) => (
              <RecoCard key={r.media.id} reco={r} lang={lang} />
            ))}
          </div>
        </>
      )}

      {result && result.avoided.length > 0 && (
        <section className="avoided">
          <h2>{tr(lang, "avoidThese")}</h2>
          <ul>
            {result.avoided.map((a) => (
              <li key={a.media.id}>
                <strong>{a.media.title}</strong> — {a.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
