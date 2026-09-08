import type { Lang } from "../../shared/strings.ts";
import { tr } from "../../shared/strings.ts";
import type { ScoredReco } from "../../shared/types.ts";

export function Hero(props: {
  reco: ScoredReco;
  lang: Lang;
  user: string;
  onOpen: (reco: ScoredReco) => void;
  onAll: () => void;
}) {
  const r = props.reco;
  const m = r.media;
  const lang = props.lang;
  return (
    <div className="hero" data-od-id="hero">
      {m.coverImage && (
        <>
          <img className="hero-bg" src={m.coverImage} alt="" aria-hidden="true" />
          <img className="hero-art" src={m.coverImage} alt="" aria-hidden="true" />
        </>
      )}
      <div className="hero-scrim" aria-hidden="true" />
      <span className="hero-score mono">{Math.round(r.final * 100)}/110</span>
      <div className="hero-body">
        <p className="eyebrow">{tr(lang, "heroTop", { u: props.user })}</p>
        <h1>
          <a href={m.siteUrl ?? "#"} target="_blank" rel="noreferrer">
            {m.title}
          </a>
        </h1>
        <div className="chips">
          {r.badges.map((b) => (
            <span key={b} className={`chip-badge ${b === "HIDDEN_GEM" ? "gem" : b === "ENTRY_POINT" ? "entry" : ""}`}>
              {tr(lang, `badge${b.split("_").map((w) => w[0] + w.slice(1).toLowerCase()).join("")}`)}
            </span>
          ))}
          {r.groupSize > 1 && <span className="chip-badge">{tr(lang, "moreInSeries", { n: r.groupSize - 1 })}</span>}
        </div>
        <p className="hero-meta">
          {[m.seasonYear, m.format, m.studio, m.averageScore != null ? `${m.averageScore}/100 AniList` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="hero-why">{r.why}</p>
        <div className="hero-cta">
          <button className="btn btn-primary" type="button" onClick={() => props.onOpen(r)}>
            {tr(lang, "heroOpen")}
          </button>
          <button className="btn btn-ghost" type="button" onClick={props.onAll}>
            {tr(lang, "allRecos")}
          </button>
        </div>
      </div>
    </div>
  );
}
