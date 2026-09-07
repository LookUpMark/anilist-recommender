import { useState } from "react";
import { tr, type Lang } from "../../shared/strings.ts";

export function UsernameForm(props: {
  lang: Lang;
  busy: boolean;
  onSubmit: (username: string) => void;
}) {
  const [value, setValue] = useState("");
  const valid = /^[A-Za-z0-9_-]{1,32}$/.test(value);
  return (
    <form
      className="username-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !props.busy) props.onSubmit(value.trim());
      }}
    >
      <label htmlFor="username">{tr(props.lang, "usernameLabel")}</label>
      <div className="row">
        <input
          id="username"
          value={value}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          aria-invalid={!valid && value.length > 0}
          aria-describedby="username-hint"
          placeholder="Josh"
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" disabled={!valid || props.busy}>
          {tr(props.lang, "go")}
        </button>
      </div>
      <p id="username-hint" className="hint" role="status">
        {valid || value.length === 0
          ? "A-Z a-z 0-9 _ - · max 32"
          : tr(props.lang, "errUserNotFound")}
      </p>
    </form>
  );
}
