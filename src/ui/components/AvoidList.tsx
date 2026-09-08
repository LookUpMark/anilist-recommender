import type { Lang } from "../../shared/strings.ts";
import { tr } from "../../shared/strings.ts";
import type { WhyNot } from "../../shared/types.ts";

export function AvoidList(props: { items: WhyNot[]; lang: Lang }) {
  const lang = props.lang;
  return (
    <div className="avoid-list" data-od-id="avoid-list">
      {props.items.map((a) => (
        <div className="avoid-row" key={a.media.id} data-od-id={`avoid-row-${a.media.id}`}>
          {a.media.coverImage ? (
            <img src={a.media.coverImage} alt={tr(lang, "coverOf", { t: a.media.title })} loading="lazy" />
          ) : (
            <span className="cover-fallback" style={{ background: a.media.coverColor ?? "var(--surface-2)" }} aria-hidden="true">
              {a.media.title[0] ?? "?"}
            </span>
          )}
          <div>
            <div className="t">
              {a.media.title}{" "}
              <span className="mono" style={{ color: "var(--muted)", fontWeight: 400, fontSize: "11.5px" }}>
                · {[a.media.seasonYear, a.media.format, a.media.studio].filter(Boolean).join(" · ")}
              </span>
            </div>
            <p className="r">{a.reason}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
