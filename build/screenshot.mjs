// README screenshots: boots the server in fixture mode (demo dataset, AniList
// independent) and captures the main views with Electron's Chromium.
// Usage: pnpm exec electron build/screenshot.mjs   (server must NOT be on :3210)
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3210;
const OUT = join(root, "docs", "screenshots");
const dataDir = mkdtempSync(join(tmpdir(), "osusume-shots-"));

// fixture mode + APP_VERSION → setup wizard fires on first load (needsSetup)
const server = spawn(
  process.execPath,
  ["--experimental-strip-types", join(root, "src", "server", "index.ts")],
  {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ANILIST_FIXTURES: "fixtures", // env value = fixtures dir (cwd-relative)
      ALR_DATA_DIR: dataDir,
      CACHE_DIR: join(dataDir, "cache"),
      APP_VERSION: "0.0.0-shots",
      PORT: String(PORT),
    },
    stdio: "inherit",
  },
);

const waitHealth = async () => {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not come up");
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Navigate to a UI state, wait for a selector, capture. */
const shoot = async (win, name, { js = "", selector = ".app, .wizard", settle = 700 } = {}) => {
  if (js) await win.webContents.executeJavaScript(js);
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const ok = await win.webContents
      .executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`)
      .catch(() => false);
    if (ok) break;
    await sleep(150);
  }
  await sleep(settle); // fonts + entrance animations
  const img = await win.webContents.capturePage();
  writeFileSync(join(OUT, `${name}.png`), img.toPNG());
  console.log("shot", name);
};

app.whenReady().then(async () => {
  await waitHealth();
  const win = new BrowserWindow({ show: false, width: 1440, height: 900, useContentSize: true });
  const url = `http://127.0.0.1:${PORT}`;

  // 1 — setup wizard (fresh config: needsSetup true)
  await win.loadURL(url);
  await shoot(win, "setup-wizard", { selector: ".wizard", settle: 1200 });

  // ack the version marker → next loads land in the app
  await win.webContents.executeJavaScript(`fetch('/api/setup/ack',{method:'POST'})`);
  await win.loadURL(url); // reload lands on home
  // hide the outage/demo banner: screenshots should show the product, not today's API state
  await win.webContents.insertCSS("[data-od-id='local-banner'], .local-banner { display: none !important; }");
  // run a search so the home view is populated (native setter + submit, React-controlled input)
  await win.webContents.executeJavaScript(`(() => {
    const i = document.querySelector(".topbar input, form input");
    if (!i) return;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(i, "LookUpMark");
    i.dispatchEvent(new Event("input", { bubbles: true }));
    i.closest("form").requestSubmit();
  })(); 0`);
  await shoot(win, "home", { selector: ".mcard", settle: 1800 });

  // 2 — detail dialog
  await win.webContents.executeJavaScript(`document.querySelector(".mcard")?.click()`);
  await shoot(win, "detail", { selector: ".dlg", settle: 900 });
  await win.webContents.executeJavaScript(
    `document.querySelector(".dlg-scrim")?.dispatchEvent(new MouseEvent("click",{bubbles:true})); 0`,
  );

  // 3/4 — other views via the rail buttons (same session: results stay loaded)
  const navIndex = { gems: 2, settings: 5 };
  for (const v of ["gems", "settings"]) {
    await win.webContents.executeJavaScript(
      `document.querySelectorAll(".nav button")[${navIndex[v]}]?.click(); 0`,
    );
    await shoot(win, v, { settle: 1000 });
  }

  app.quit();
  server.kill("SIGTERM");
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(0), 500);
});
