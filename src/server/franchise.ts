import type { ListEntry, MediaLite } from "../shared/types.ts";

export type FranchiseKind = "STANDALONE" | "NEXT_STEP" | "ENTRY_POINT" | "EXCLUDED";

export interface FranchiseInfo {
  kind: FranchiseKind;
  /** First entry of the chain (prequel-most known id). Groups share this. */
  rootId: number;
  /** Where the user should start watching (only for ENTRY_POINT). */
  entryPointId: number | null;
  /** Prequel the user dropped (only for EXCLUDED). */
  droppedId: number | null;
}

const SEEN: ReadonlySet<string> = new Set(["COMPLETED", "CURRENT", "REPEATING", "PAUSED"]);
const MAX_DEPTH = 10;

/**
 * Classify each candidate against the user's list using PREQUEL chains.
 * Pure: relations come from the candidate pool only; prequels outside the pool
 * end the chain (their id is still known and can be fetched separately).
 */
export function analyzeFranchises(
  candidates: MediaLite[],
  listMap: Map<number, ListEntry>,
): Map<number, FranchiseInfo> {
  const prequelOf = new Map<number, number | undefined>();
  for (const m of candidates) {
    // ponytail: multiple prequels (compilations) — first edge wins
    const prequel = m.relations.find((r) => r.relationType === "PREQUEL");
    prequelOf.set(m.id, prequel?.id);
  }

  const info = new Map<number, FranchiseInfo>();
  for (const m of candidates) {
    // walk prequels: chain ordered root-most → immediate predecessor of m
    const chain: number[] = [];
    const visited = new Set([m.id]);
    let cur = m.id;
    for (let hop = 0; hop < MAX_DEPTH; hop++) {
      const p = prequelOf.get(cur);
      if (p == null) break;
      if (visited.has(p)) break; // cycle guard
      visited.add(p);
      chain.push(p);
      cur = p;
    }
    chain.reverse();

    const droppedId = chain.find((id) => listMap.get(id)?.status === "DROPPED") ?? null;
    const firstUnseen = chain.find((id) => {
      const e = listMap.get(id);
      return !e || e.status === "PLANNING" || !SEEN.has(e.status);
    });

    let kind: FranchiseKind;
    let entryPointId: number | null = null;
    if (droppedId != null) {
      kind = "EXCLUDED";
    } else if (chain.length === 0) {
      kind = "STANDALONE";
    } else if (firstUnseen == null) {
      kind = "NEXT_STEP";
    } else {
      kind = "ENTRY_POINT";
      entryPointId = firstUnseen;
    }
    info.set(m.id, {
      kind,
      rootId: chain[0] ?? m.id,
      entryPointId,
      droppedId,
    });
  }
  return info;
}

/** True if a candidate is a spin-off / side-story (informational badge only). */
export function isSpinOff(m: MediaLite): boolean {
  return m.relations.some((r) => r.relationType === "SPIN_OFF" || r.relationType === "SIDE_STORY");
}
