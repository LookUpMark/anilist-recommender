import { useState } from "react";
import type { Lang } from "../../shared/strings.ts";
import { tr } from "../../shared/strings.ts";
import { VIEW_LABEL, type View } from "../views.ts";

const VALID = /^[A-Za-z0-9_-]{1,32}$/;

export function Topbar(props: {
  view: View;
  lang: Lang;
  user: string;
  busy: boolean;
  onLang: () => void;
  onProfile: () => void;
  onSubmit: (username: string) => void;
}) {
  const { lang } = props;
  const [value, setValue] = useState("");
  const invalid = value.length > 0 && !VALID.test(value);

  return (
    <header className="topbar" data-od-id="topbar">
      <p className="page-title" id="page-title" aria-live="polite">
        {tr(lang, VIEW_LABEL[props.view])}
      </p>
      <form
        className="search"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const u = value.trim();
          if (VALID.test(u) && !props.busy) props.onSubmit(u);
        }}
      >
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          placeholder="josh"
          aria-label={tr(lang, "userField")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={invalid}
          title={invalid ? tr(lang, "searchErr") : undefined}
        />
        <button className="go" type="submit" aria-label={tr(lang, "searchGo")} title={tr(lang, "searchGo")} disabled={props.busy}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16.2 16.2 4.3 4.3" />
          </svg>
        </button>
      </form>
      {props.user && (
        <button type="button" className="user-link" onClick={props.onProfile} title={tr(lang, "navProfile")} data-od-id="user-link">
          <span className="at">@</span>
          {props.user}
        </button>
      )}
    </header>
  );
}
