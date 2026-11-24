/**
 * Whether a recording found elsewhere is exactly the Spotify song: same title, same
 * (first) artist, same length. Pure; the searching lives in search.ts.
 */
export interface Wanted {
  title: string;
  /** Spotify's artist line, e.g. "Shakira, Burna Boy". */
  artist: string;
  durationSec: number;
}

export interface Candidate {
  url: string;
  title: string;
  artists: string[];
  durationSec?: number;
  source: string;
}

/** Seconds a recording's length may differ from Spotify's (sites round differently). */
export const DURATION_TOLERANCE_S = 3;

/** Case, accents' encoding, punctuation and spacing ignored. */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// "(feat. X)", "[with X]", " - feat. X": featured artists are part of the artist line, and
// sites disagree on whether the title repeats them.
const FEATURING = /\s*(?:[([]\s*(?:feat|ft|featuring|with)\b\.?[^)\]]*[)\]]|-\s*(?:feat|ft|featuring)\b\.?.*$)/gi;

const titleKey = (title: string) => normalize(title.replace(FEATURING, ""));

/** Whole-word prefix: "shakira burna boy" starts with "shakira", not with "shak". */
const startsWithWords = (text: string, prefix: string) => prefix !== "" && (text === prefix || text.startsWith(`${prefix} `));

export function isExact(wanted: Wanted, candidate: Candidate): boolean {
  if (candidate.durationSec === undefined) return false;
  if (Math.abs(candidate.durationSec - wanted.durationSec) > DURATION_TOLERANCE_S) return false;
  if (titleKey(candidate.title) !== titleKey(wanted.title)) return false;
  const first = candidate.artists[0];
  return first !== undefined && startsWithWords(normalize(wanted.artist), normalize(first));
}

/**
 * SoundCloud uploads often put the artist into the title ("Artist - Title") under a label's
 * account. When the part before " - " is the wanted artist, that is the artist.
 */
export function splitArtistTitle(candidate: Candidate, wanted: Wanted): Candidate {
  const dash = candidate.title.indexOf(" - ");
  if (dash < 0) return candidate;
  const artist = candidate.title.slice(0, dash);
  if (!startsWithWords(normalize(wanted.artist), normalize(artist))) return candidate;
  return { ...candidate, title: candidate.title.slice(dash + 3), artists: [artist] };
}

/** One line per candidate, for telling the user what was found instead. */
export function describe(candidate: Candidate): string {
  const length = candidate.durationSec === undefined ? "?" : `${Math.round(candidate.durationSec)} s`;
  return `${candidate.source}: ${candidate.artists.join(", ") || "?"} – ${candidate.title} (${length}) ${candidate.url}`;
}
