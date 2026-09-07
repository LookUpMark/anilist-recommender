import { useEffect, useState } from "react";
import { tr, type Lang } from "../../shared/strings.ts";
import type { SetupStatus } from "../../shared/types.ts";
import { fetchSetupStatus, postSetup } from "../api.ts";

const osLabel = (s: SetupStatus, lang: Lang): string =>
  s.hardware.os === "mac"
    ? tr(lang, "osMac")
    : s.hardware.os === "win"
      ? tr(lang, "osWin")
      : tr(lang, "osLinux");

export function SetupWizard(props: {
  lang: Lang;
  setLang: (l: Lang) => void;
  initial: SetupStatus;
  onDone: () => void;
}) {
  const { lang } = props;
  const [status, setStatus] = useState<SetupStatus>(props.initial);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState<string>(props.initial.suggested.model);
  const [customOpen, setCustomOpen] = useState(false);
  const [customUrl, setCustomUrl] = useState("");

  // poll while the wizard is open: job progress + backend state
  useEffect(() => {
    const t = setInterval(() => {
      fetchSetupStatus()
        .then(setStatus)
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(t);
  }, []);

  // once the chosen model shows up in lms ls, move to the finish screen
  const downloaded = status.downloadedModels.some(
    (m) => m.includes(model) || model.includes(m),
  );
  const step = status.setupDone ? 3 : downloaded ? 2 : 1;

  async function finish(body: object) {
    setBusy(true);
    try {
      await postSetup("finish", body);
      const s = await fetchSetupStatus();
      setStatus(s);
    } finally {
      setBusy(false);
    }
  }

  const jobBusy = status.job.state === "downloading" || status.job.state === "installing-cli";

  return (
    <main className="app wizard">
      <header>
        <div>
          <h1>{tr(lang, "setupTitle")}</h1>
          <p className="tagline">{tr(lang, "setupIntro")}</p>
        </div>
        <div className="header-side">
          <button className="lang" onClick={() => props.setLang(lang === "en" ? "it" : "en")}>
            {tr(lang, "langToggle")}
          </button>
        </div>
      </header>

      <section className="profile-panel">
        <h2>{tr(lang, "hwOs")}: {osLabel(status, lang)}</h2>
        <p className="profile-meta">
          {tr(lang, "hwChip")}: <strong>{status.hardware.chip}</strong> · {tr(lang, "hwRam")}:{" "}
          <strong>{status.hardware.ramGb} GB</strong>
        </p>

        {step === 1 && (
          <>
            <div className="model-card">
              <span>
                {tr(lang, "recModel")}: <strong>{model}</strong>{" "}
                ({status.suggested.sizeGb} GB)
              </span>
              {status.suggested.mlx && (
                <label className="mlx-opt">
                  <input
                    type="checkbox"
                    checked={model.includes("-mlx")}
                    onChange={(e) =>
                      setModel(e.target.checked ? status.suggested.mlx!.model : status.suggested.model)
                    }
                  />
                  {tr(lang, "mlxOpt")}
                </label>
              )}
            </div>
            {model.includes("-mlx") && (
              <p className="warn-box">
                {tr(lang, "mlxWarn")}
                <code>uvx --from https://github.com/PrismML/mlx-lm mlx_lm.server --model {model}</code>
              </p>
            )}
            {!status.lms.installed && (
              <div className="action-row">
                <span className="warn-box">{tr(lang, "backendMissing")}</span>
                <button
                  disabled={jobBusy}
                  onClick={async () => {
                    setBusy(true);
                    await postSetup("install-cli").catch(() => undefined);
                    setBusy(false);
                  }}
                >
                  {status.job.state === "installing-cli"
                    ? tr(lang, "installingCli")
                    : tr(lang, "installCli")}
                </button>
                {status.hardware.os === "win" && <p className="hint">{tr(lang, "winFirstRun")}</p>}
              </div>
            )}
            <div className="action-row">
              <button
                disabled={busy || !status.lms.installed}
                onClick={() => finish({ model })}
              >
                {tr(lang, "download")}
              </button>
              {status.hardware.os === "win" && status.lms.installed && (
                <p className="hint">{tr(lang, "winFirstRun")}</p>
              )}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="loading">
              {tr(lang, "downloading")} <strong>{model}</strong>
            </p>
            <div className="progress" aria-hidden="true">
              <span />
            </div>
            {status.job.logTail && <pre className="joblog">{status.job.logTail}</pre>}
            <div className="action-row">
              <button disabled={busy} onClick={() => finish({ model })}>
                {tr(lang, "skipDownload")}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>{tr(lang, "finishTitle")}</h2>
            <p className="loading">
              {status.llm.state === "starting"
                ? tr(lang, "llmStarting")
                : status.llm.state === "up"
                  ? tr(lang, "llmReady")
                  : tr(lang, "llmOffNote")}
            </p>
            <div className="action-row">
              <button disabled={busy} onClick={props.onDone}>
                {tr(lang, "startUsing")}
              </button>
            </div>
          </>
        )}

        <div className="wizard-footer">
          <button className="linklike" onClick={() => setCustomOpen(!customOpen)}>
            {tr(lang, "useCustom")}
          </button>
          {customOpen && (
            <div className="action-row">
              <input
                placeholder={tr(lang, "customUrl")}
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
              />
              <button disabled={busy || !/^https?:\/\//.test(customUrl)} onClick={() => finish({ baseUrl: customUrl, model })}>
                {tr(lang, "customUse")}
              </button>
            </div>
          )}
          <button
            className="linklike"
            disabled={busy}
            onClick={() => finish({ backend: "skipped" })}
          >
            {tr(lang, "skipSetup")}
          </button>
          {status.job.state === "error" && (
            <p className="error">
              {tr(lang, "downloadFailed")} {status.job.error}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
