import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getRequestListener, serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { PORT } from "./config.ts";
import { api } from "./api.ts";
import { ensureLlmServer } from "./setup.ts";

// 127.0.0.1 by default (loopback-only by design); containers set HOST=0.0.0.0 —
// the /api Host allowlist middleware still guards what comes through the mapping
const HOST = process.env.HOST ?? "127.0.0.1";

const app = new Hono();
app.route("/api", api);

if (process.env.NODE_ENV !== "production") {
  // API through Hono, everything else through Vite (same process, one command)
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  const apiListener = getRequestListener(app.fetch);
  createHttpServer((req: IncomingMessage, res: ServerResponse) =>
    req.url?.startsWith("/api") ? apiListener(req, res) : vite.middlewares(req, res),
  ).listen(PORT, HOST);
} else {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("/*", serveStatic({ path: "./dist/index.html" }));
  serve({ fetch: app.fetch, port: PORT, hostname: HOST });
}

ensureLlmServer(); // fire-and-forget: no-op unless the setup wizard completed
console.log(`anilist-recommender on http://127.0.0.1:${PORT}`);
