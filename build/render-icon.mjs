// Render public/icon.svg → build/icon.png using Electron's Chromium.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public", "icon.svg"), "utf8");

app.whenReady().then(async () => {
  // useContentSize: the 1024×1024 is the *content* area (titlebar would shrink it)
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true });
  // base64: encodeURIComponent leaves "#" unescaped, and url(#gradient) ids
  // would be cut off as a URL fragment mid-document (only the first path painted)
  await win.loadURL(
    "data:text/html;base64," +
      Buffer.from(
        `<html><body style="margin:0;width:1024px;height:1024px;overflow:hidden">${svg}</body></html>`,
      ).toString("base64"),
  );
  await new Promise((r) => setTimeout(r, 200));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  writeFileSync(join(root, "build", "icon.png"), image.toPNG());
  const s = image.getSize();
  console.log("OK build/icon.png", JSON.stringify(s));
  app.quit();
  setTimeout(() => process.exit(0), 500); // never hang the script
});
