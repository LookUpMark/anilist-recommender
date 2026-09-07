import type { Lang } from "../../shared/strings.ts";
import { tr } from "../../shared/strings.ts";
import type { ScoredReco } from "../../shared/types.ts";

function MiniBar(props: { label: string; value: number }) {
  return (
    <div className="mini" title={props.label}>
      <span className="mini-label">{props.label}</span>
      <span className="mini-bar">
        <span style={{ width: `${Math.round(props.value * 100)}%` }} />
      </span>
    </div>
  );
}

export function RecoCard(props: { reco: ScoredReco; lang: Lang }) {
  const r = props.reco;
  const m = r.media;
  const lang = props.lang;
  return (
    <article className="reco-card">
      <a href={m.siteUrl ?? "#"} target="_blank" rel="noreferrer" className="cover-link">
        {m.coverImage ? (
          <img src={m.coverImage} alt={`Cover of ${m.title}`} loading="lazy" />
        ) : (
          <div className="cover-fallback" aria-hidden="true" />
        )}
      </a>
      <div className="reco-body">
        <header>
          <h3>
            <a href={m.siteUrl ?? "#"} target="_blank" rel="noreferrer">
              {m.title}
            </a>
          </h3>
          <p className="meta">
            {[m.seasonYear, m.format, m.studio].filter(Boolean).join(" · ")}
          </p>
        </header>
        <div className="badges">
          {r.badges.map((b) => (
            <span key={b} className={`badge badge-${b.toLowerCase()}`}>
              {tr(lang, `badge${b.split("_").map((w) => w[0] + w.slice(1).toLowerCase()).join("")}`)}
            </span>
          ))}
          {r.groupSize > 1 && (
            <span className="badge group">{tr(lang, "moreInSeries", { n: r.groupSize - 1 })}</span>
          )}
        </div>
        <p className="score">
          <strong>{Math.round(r.final * 100)}</strong>
          <span className="score-max">/110</span>
        </p>
        <div className="minis">
          <MiniBar label={tr(lang, "affinity")} value={r.breakdown.affinity} />
          <MiniBar label={tr(lang, "quality")} value={r.breakdown.quality} />
          <MiniBar label={tr(lang, "community")} value={r.breakdown.community * 10} />
        </div>
        <p className="why">{r.why}</p>
      </div>
    </article>
  );
}
