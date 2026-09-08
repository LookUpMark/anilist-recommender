import { APP_VERSION } from "./config.ts";

export const RELEASES_URL = "https://api.github.com/repos/LookUpMark/osusume/releases/latest";

/** Numeric 3-part compare: >0 if a is newer. Tolerant of a "v" prefix and a
 *  "-prerelease" suffix (prereleases never count as newer than their release). */
export function cmpVersion(a: string, b: string): number {
  const p = (v: string) =>
    v
      .replace(/^v/, "")
      .split("-")[0]
      .split(".")
      .map((x) => Number(x) || 0);
  const [pa, pb] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

let memoAt = 0;
let memoTag: string | null = null;
let memoUrl: string | null = null;
const MEMO_MS = 5 * 60 * 1000; // GitHub anonymous rate limit is 60/h

async function latestRelease(): Promise<{ tag: string | null; url: string | null }> {
  if (Date.now() - memoAt < MEMO_MS) return { tag: memoTag, url: memoUrl };
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { tag_name?: string; html_url?: string };
    memoTag = json.tag_name ?? null;
    memoUrl = json.html_url ?? null;
  } catch {
    memoTag = null; // offline / rate-limited → "no update info", never an error
    memoUrl = null;
  }
  memoAt = Date.now();
  return { tag: memoTag, url: memoUrl };
}

export interface AppUpdateStatus {
  current: string | null;
  latest: string | null;
  url: string | null;
  available: boolean;
}

/** Update check: APP_VERSION is injected by the Electron main (absent in dev/docker). */
export async function appUpdateStatus(): Promise<AppUpdateStatus> {
  const current = APP_VERSION ?? null;
  if (!current) return { current: null, latest: null, url: null, available: false };
  const { tag, url } = await latestRelease();
  return {
    current,
    latest: tag,
    url,
    available: Boolean(tag && url && cmpVersion(tag, current) > 0),
  };
}
