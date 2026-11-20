/**
 * Tells Jellyfin which files changed, so new and edited songs show up within seconds
 * instead of waiting for its folder watcher (which skips a library folder that was
 * empty when Jellyfin started) or its next scheduled scan.
 */
import { relative } from "node:path";

export interface FileChange {
  /** The file as the app sees it, below its library directory. */
  file: string;
  type: "Created" | "Modified" | "Deleted";
}

export interface JellyfinOptions {
  url: string;
  /** Without a key, reporting is switched off. */
  apiKey: string;
  /** The library directory as the app sees it… */
  libraryDir: string;
  /** …and the same directory as Jellyfin sees it. */
  libraryPath: string;
}

export function createJellyfin(options: JellyfinOptions) {
  const toJellyfin = (file: string) => `${options.libraryPath}/${relative(options.libraryDir, file)}`;

  return {
    /** Reports `changes`; failures are logged, never thrown — Jellyfin's own scan catches up. */
    async report(changes: FileChange[]): Promise<void> {
      if (!options.apiKey || changes.length === 0) return;
      try {
        const response = await fetch(`${options.url}/Library/Media/Updated`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Emby-Token": options.apiKey },
          body: JSON.stringify({ Updates: changes.map((c) => ({ Path: toJellyfin(c.file), UpdateType: c.type })) }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      } catch (error) {
        console.error(`Telling Jellyfin about ${changes.length} changed file(s) failed: ${(error as Error).message}`);
      }
    },
  };
}
