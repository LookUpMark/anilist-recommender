import type { DimValue, TasteProfile } from "../../shared/types.ts";
import { tr, type Lang } from "../../shared/strings.ts";

function DimBar(props: { d: DimValue; lang: Lang; negative: boolean }) {
  const pct = Math.min(100, Math.abs(props.d.aff) * 100);
  return (
    <div className="dim-row">
      <span className="dim-label">
        {tr(
          props.lang,
          `dim${props.d.dim[0].toUpperCase()}${props.d.dim.slice(1)}`,
        )}
        : {props.d.value}
      </span>
      <span className={`dim-bar ${props.negative ? "neg" : "pos"}`}>
        <span style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

export function ProfilePanel(props: { profile: TasteProfile; lang: Lang }) {
  const p = props.profile;
  const lang = props.lang;
  return (
    <section className="profile-panel" aria-label={tr(lang, "yourTaste")}>
      <h2>{tr(lang, "yourTaste")}</h2>
      <p className="profile-meta">
        {tr(lang, "meanScore")}: <strong>{p.meanScore}</strong> ·{" "}
        {tr(lang, "completed")}: {p.counts.COMPLETED} · {tr(lang, "dropped")}: {p.counts.DROPPED} ·{" "}
        {tr(lang, "paused")}: {p.counts.PAUSED} · {tr(lang, "current")}: {p.counts.CURRENT}
        {p.confidence === "low" && <span className="chip warn"> {tr(lang, "confidenceLow")}</span>}
      </p>
      <div className="dim-cols">
        <div>
          <h3>{tr(lang, "loved")}</h3>
          {p.loved.map((d) => (
            <DimBar key={`${d.dim}:${d.value}`} d={d} lang={lang} negative={false} />
          ))}
        </div>
        <div>
          <h3>{tr(lang, "disliked")}</h3>
          {p.disliked.map((d) => (
            <DimBar key={`${d.dim}:${d.value}`} d={d} lang={lang} negative={true} />
          ))}
        </div>
      </div>
    </section>
  );
}
