import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { READER_DIR } from "./store.ts";

export const ICON_DIR = join(READER_DIR, "icons");

/**
 * Favicons, fetched once and kept.
 *
 * The browser asks this server for them rather than the icon service directly.
 * The list of sites someone reads is the thing this library exists to keep on
 * their own disk, and pointing 136 rows straight at a third party would hand
 * over exactly that, once per page load. Here it leaves the machine once per
 * domain, ever.
 */
const SOURCE = (host: string) => `https://icons.duckduckgo.com/ip3/${host}.ico`;

/** Domains that resolved to nothing this run; asking again in the same minute is pointless. */
const missing = new Set<string>();

/** A host, or null if it is not one. Guards the path built from it. */
export function safeHost(input: string): string | null {
  const host = input.trim().toLowerCase();
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) ? host : null;
}

export async function icon(host: string): Promise<Buffer | null> {
  const path = join(ICON_DIR, `${host}.ico`);
  if (existsSync(path)) return readFileSync(path);
  if (missing.has(host)) return null;

  let body: ArrayBuffer;
  try {
    const res = await fetch(SOURCE(host), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(String(res.status));
    body = await res.arrayBuffer();
    // The service answers a miss with a 1x1 placeholder rather than a 404.
    if (body.byteLength < 100) throw new Error("empty");
  } catch {
    missing.add(host);
    return null;
  }

  mkdirSync(ICON_DIR, { recursive: true });
  const buf = Buffer.from(body);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, buf);
  renameSync(tmp, path);
  return buf;
}
