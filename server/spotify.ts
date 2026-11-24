/**
 * A Spotify song's details from its public page, no account needed. Read from the page's
 * link-preview tags (Open Graph and `music:*`), which chat apps and search engines depend
 * on. If Spotify ever drops one of them, the page's text goes to the AI instead, so a
 * markup change degrades rather than breaks.
 */
import { join } from "node:path";
import type { ChatJson } from "./ollama";

export interface SpotifyTrack {
  id: string;
  title: string;
  /** Spotify's artist line, e.g. "Shakira, Burna Boy". */
  artist: string;
  album: string;
  year?: number;
  durationSec: number;
  coverUrl?: string;
}

export type Details = Omit<SpotifyTrack, "id">;

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };

export function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
    return String.fromCodePoint(code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1)));
  });
}

/** Every `<meta>` tag's content by its property or name, in page order. */
export function readMeta(html: string): Map<string, string[]> {
  const meta = new Map<string, string[]>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? "");
    const key = attrs.property ?? attrs.name;
    if (!key || attrs.content === undefined) continue;
    meta.set(key, [...(meta.get(key) ?? []), attrs.content.trim()]);
  }
  return meta;
}

/** What the link-preview tags say; any field may be missing. */
export function fromMeta(meta: Map<string, string[]>): Partial<Details> {
  const one = (key: string) => meta.get(key)?.find((v) => v !== "");
  const details: Partial<Details> = {};

  const title = one("og:title");
  if (title) details.title = title;
  const artists = [...new Set(meta.get("music:musician_description") ?? [])].filter(Boolean);
  if (artists.length > 0) details.artist = artists.join(", ");

  // "Artist · Album · Song · 1987": the album is what sits between the artist line and
  // the last two parts (the kind of item and the year).
  const description = one("og:description");
  if (description && details.artist?.length && description.startsWith(`${details.artist} · `)) {
    const parts = description.slice(details.artist.length + 3).split(" · ");
    if (parts.length >= 3) details.album = parts.slice(0, -2).join(" · ");
  }

  const year = Number((one("music:release_date") ?? "").slice(0, 4));
  if (year >= 1000 && year <= 9999) details.year = year;
  const duration = Number(one("music:duration"));
  if (duration > 0) details.durationSec = duration;
  const cover = one("og:image");
  if (cover?.startsWith("https://")) details.coverUrl = cover;
  return details;
}

/** The page as plain text for the AI: title, meta tags, structured data, visible text. */
export function pageText(html: string, limit = 6000): string {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "";
  const meta = [...readMeta(html)].map(([k, v]) => `${k}: ${v.join(" | ")}`);
  const jsonLd = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!.slice(0, 1500));
  const body = decode(
    html
      .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
  return [`title: ${decode(title)}`, ...meta, ...jsonLd, body].join("\n").slice(0, limit);
}

const SYSTEM_PROMPT = `You read a Spotify song page and report the song's details exactly as the page states them.
- title: the song title only.
- artist: all performing artists, comma-separated, in the page's order.
- album: the album the song is on (for a single, the single's name).
- year: release year.
- duration_seconds: the song's length in seconds.
Copy names verbatim. If the page does not state a field, answer an empty string or 0.`;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    artist: { type: "string" },
    album: { type: "string" },
    year: { type: "integer" },
    duration_seconds: { type: "number" },
  },
  required: ["title", "artist", "album", "year", "duration_seconds"],
};

async function askPage(chat: ChatJson, html: string): Promise<Partial<Details>> {
  const raw = (await chat(SYSTEM_PROMPT, pageText(html), SCHEMA)) as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string).trim() : "");
  const details: Partial<Details> = {};
  if (text("title")) details.title = text("title");
  if (text("artist")) details.artist = text("artist");
  if (text("album")) details.album = text("album");
  if (typeof raw.year === "number" && raw.year >= 1000 && raw.year <= 9999) details.year = raw.year;
  if (typeof raw.duration_seconds === "number" && raw.duration_seconds > 0) details.durationSec = raw.duration_seconds;
  return details;
}

const REQUIRED = ["title", "artist", "album", "durationSec"] as const;
const missing = (details: Partial<Details>) => REQUIRED.filter((key) => !details[key]);

/** Details from a page's HTML: the tags first, the AI only for what they lack. */
export async function readPage(html: string, chat: ChatJson): Promise<Details> {
  let details = fromMeta(readMeta(html));
  if (missing(details).length > 0) {
    console.error(`Spotify page lacks ${missing(details).join(", ")} in its tags, asking the AI`);
    // The tags still win where they have a value; the AI fills the gaps.
    details = { ...(await askPage(chat, html)), ...details };
  }
  const gaps = missing(details);
  if (gaps.length > 0) throw new Error(`Die Spotify-Seite verrät nicht alles Nötige (fehlt: ${gaps.join(", ")}).`);
  return details as Details;
}

export async function fetchTrack(id: string, chat: ChatJson): Promise<SpotifyTrack> {
  const response = await fetch(`https://open.spotify.com/track/${id}`, {
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)", "Accept-Language": "en" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Spotify answered ${response.status} for track ${id}`);
  return { id, ...(await readPage(await response.text(), chat)) };
}

/** Downloads the cover into `dir`; null when there is none or it fails. */
export async function downloadCover(url: string | undefined, dir: string): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    const file = join(dir, "cover.jpg");
    await Bun.write(file, await response.arrayBuffer());
    return file;
  } catch {
    return null;
  }
}
