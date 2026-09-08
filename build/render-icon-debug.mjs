import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const root = process.cwd();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true });
  await win.loadFile(join(root, "public", "icon.svg"));
  await new Promise((r) => setTimeout(r, 300));
  const info = await win.webContents.executeJavaScript(
    `JSON.stringify({
      n: document.querySelectorAll("path").length,
      boxes: [...document.querySelectorAll("path")].map(p => { const b = p.getBBox(); return [b.x|0, b.y|0, (b.width|0), (b.height|0)] }),
      rects: document.querySelectorAll("rect").length,
      svgWH: [document.querySelector("svg").clientWidth, document.querySelector("svg").clientHeight],
    })`,
  );
  console.log("DOM:", info);
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  writeFileSync(join(root, "build", "icon-standalone.png"), image.toPNG());
  console.log("OK build/icon-standalone.png");
  app.quit();
  setTimeout(() => process.exit(0), 400);
});
