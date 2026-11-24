/**
 * Finds the audio for a Spotify song elsewhere: YouTube Music's songs first, then
 * SoundCloud, through yt-dlp. Only an exact match (match.ts) is taken.
 */
import { $ } from "bun";
import { describe, isExact, splitArtistTitle, type Candidate, type Wanted } from "./match";

const RESULTS = 5;

interface Entry {
  webpage_url?: string;
  url?: string;
  title?: string;
  track?: string;
  artists?: string[];
  artist?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
}

function candidate(entry: Entry, source: string): Candidate {
  const artists = entry.artists ?? (entry.artist ? [entry.artist] : []);
  const fallback = (entry.channel ?? entry.uploader)?.replace(/ - Topic$/, "");
  return {
    url: entry.webpage_url ?? entry.url ?? "",
    title: entry.track ?? entry.title ?? "",
    artists: artists.length > 0 ? artists : fallback ? [fallback] : [],
    durationSec: entry.duration,
    source,
  };
}

/**
 * The results yt-dlp printed. A failed search (blocked, offline, outdated yt-dlp) must not
 * read as "nothing found", so it throws unless some results came through.
 */
function parseResults(result: { exitCode: number; stdout: Buffer; stderr: Buffer }, source: string): Entry[] {
  const entries = result.stdout
    .toString()
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Entry);
  if (result.exitCode !== 0 && entries.length === 0) {
    throw new Error(`Suche auf ${source} fehlgeschlagen: ${result.stderr.toString().trim().split("\n").pop()}`);
  }
  return entries;
}

/** The first few "songs" results of a YouTube Music search, with their full info. */
async function youtubeMusic(query: string): Promise<Candidate[]> {
  const url = `https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs`;
  // One unavailable result must not hide the others.
  const result = await $`yt-dlp --js-runtimes bun --skip-download --ignore-errors --no-progress --playlist-end ${RESULTS} --dump-json -- ${url}`
    .quiet()
    .nothrow();
  return parseResults(result, "YouTube Music").map((entry) => candidate(entry, "YouTube Music"));
}

async function soundCloud(query: string): Promise<Candidate[]> {
  const result = await $`yt-dlp --flat-playlist --ignore-errors --dump-json -- ${`scsearch${RESULTS}:${query}`}`.quiet().nothrow();
  return parseResults(result, "SoundCloud").map((entry) => candidate(entry, "SoundCloud"));
}

export type Search = (query: string) => Promise<Candidate[]>;

/**
 * The URL of the first exact match, trying each search in turn. Throws, listing what was
 * found instead (and which searches failed), so a fitting link can be pasted by hand.
 */
export async function findAudio(wanted: Wanted, searches: Search[] = [youtubeMusic, soundCloud]): Promise<string> {
  const query = `${wanted.artist} ${wanted.title}`;
  const seen: Candidate[] = [];
  const failures: string[] = [];
  for (const search of searches) {
    let found: Candidate[];
    try {
      found = (await search(query)).map((c) => splitArtistTitle(c, wanted));
    } catch (error) {
      failures.push((error as Error).message);
      continue;
    }
    const exact = found.find((c) => c.url && isExact(wanted, c));
    if (exact) return exact.url;
    seen.push(...found);
  }
  const closest = seen.length > 0 ? `\nGefunden, aber nicht exakt:\n${seen.slice(0, 6).map(describe).join("\n")}` : "";
  const failed = failures.length > 0 ? `\n${failures.join("\n")}` : "";
  throw new Error(`Keine exakt passende Aufnahme auf YouTube Music oder SoundCloud gefunden.${closest}${failed}`);
}
