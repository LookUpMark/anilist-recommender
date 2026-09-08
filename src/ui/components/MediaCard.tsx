import type { Lang } from "../../shared/strings.ts";
import { tr } from "../../shared/strings.ts";
import type { ScoredReco } from "../../shared/types.ts";

/** NEXT_STEP → "badgeNextStep" (i18n key, same scheme as the scoring server). */
const badgeKey = (b: string) =>
  `badge${b.split("_").map((w) => w[0] + w.slice(1).toLowerCase()).join("")}`;

export function MediaCard(props: {
  reco: ScoredReco;
  lang: Lang;
  eager?: boolean;
  onOpen: (reco: ScoredReco) => void;
}) {
  const r = props.reco;
  const m = r.media;
  const lang = props.lang;
  const aff = Math.min(100, Math.max(0, Math.round(r.breakdown.affinity * 100)));
  return (
    <button
      type="button"
      className="mcard"
      data-od-id={`reco-card-${m.id}`}
      onClick={() => props.onOpen(r)}
      aria-label={`${m.title}: ${tr(lang, "heroOpen")}`}
    >
      <span className="poster">
        <span className="prog" aria-hidden="true">
          <span style={{ width: `${aff}%` }} />
        </span>
        {m.coverImage ? (
          <img
            src={m.coverImage}
            alt={tr(lang, "coverOf", { t: m.title })}
            loading={props.eager ? "eager" : "lazy"}
          />
        ) : (
          <span className="cover-fallback" style={{ background: m.coverColor ?? "var(--surface-2)" }} aria-hidden="true">
            {m.title[0] ?? "?"}
          </span>
        )}
        <span className="score-tag mono">{Math.round(r.final * 100)}/110</span>
        <span className="ovl">
          <span className="t">{m.title}</span>
          <span className="m">{[m.seasonYear, m.format].filter(Boolean).join(" · ")}</span>
        </span>
      </span>
      <span className="sub">
        <span className="row1">
          <span className="meta">{m.studio ?? ""}</span>
          <span className="aff">{tr(lang, "kAffinity")} {aff}%</span>
        </span>
        <span className="chips">
          {r.badges.map((b) => (
            <span key={b} className={`chip-badge ${b === "HIDDEN_GEM" ? "gem" : b === "ENTRY_POINT" ? "entry" : ""}`}>
              {tr(lang, badgeKey(b))}
            </span>
          ))}
          {r.groupSize > 1 && <span className="chip-badge">{tr(lang, "moreInSeries", { n: r.groupSize - 1 })}</span>}
        </span>
      </span>
    </button>
  );
}
