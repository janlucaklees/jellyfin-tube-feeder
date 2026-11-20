/**
 * Turns video info into song tags: the AI proposes, code-side rules make sure
 * nothing empty or placeholder-like ever reaches the library.
 */
import type { TagName, Tags } from "./song";
import type { VideoInfo } from "./youtube";

export type Ask = (info: VideoInfo, hint?: string) => Promise<Partial<Tags>>;

export interface Resolved {
  tags: Tags;
  fallbacks: TagName[];
}

const SYSTEM_PROMPT = `You turn YouTube video information into clean MP3 tags for a family music library.
Rules:
- artist: the performing artist or band. If the title doesn't name one, use the channel name, minus generic suffixes like "- Kinderlieder" or "- Musik für Dich".
- title: only the song name. Remove artist names, "Official Video", "Lyrics", "HD", "Kinderlieder zum Mitsingen", channel names, emojis and similar noise. Keep version info like "(Version 2015)".
- album: the album only if the video information or the user's hints name one, otherwise repeat the title. A channel name is not an album.
- year: release year if known, else upload year.
- If the user gives hints, they are authoritative and override the video information.
- Never answer "Unknown", "N/A" or add commentary. Keep the original language.`;

const SCHEMA = {
  type: "object",
  properties: {
    artist: { type: "string" },
    title: { type: "string" },
    album: { type: "string" },
    year: { type: "integer" },
  },
  required: ["artist", "title", "album", "year"],
};

/** The default `Ask`: one schema-constrained call to an Ollama model. */
export function askOllama(ollamaUrl: string, model: string): Ask {
  return async (info, hint) => {
    const video = {
      title: info.title,
      channel: info.channel,
      uploader: info.uploader,
      artist: info.artist,
      track: info.track,
      album: info.album,
      release_year: info.release_year,
      upload_date: info.upload_date,
      tags: info.tags,
      description: info.description?.slice(0, 800),
    };
    let content = `Video information:\n${JSON.stringify(video)}`;
    if (hint) content += `\n\nHints from the user:\n${hint}`;

    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        format: SCHEMA,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Ollama (${model}) answered ${response.status}: ${await response.text()}`);
    const body = (await response.json()) as { message: { content: string } };
    return JSON.parse(body.message.content) as Partial<Tags>;
  };
}

const PLACEHOLDER = /^(unknown|unbekannt|n\/?a|none|null|undefined|-|\?+)$/i;

function usable(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !PLACEHOLDER.test(value.trim());
}

export async function resolveTags(info: VideoInfo, opts: { hint?: string; ask: Ask }): Promise<Resolved> {
  let ai: Partial<Tags> = {};
  try {
    ai = await opts.ask(info, opts.hint);
  } catch (error) {
    console.error(`AI tagging failed for ${info.id}, using fallbacks: ${(error as Error).message}`);
  }

  const fallbacks: TagName[] = [];
  const pick = (name: TagName, value: unknown, ...candidates: (string | undefined)[]): string => {
    if (usable(value)) return value.trim();
    fallbacks.push(name);
    return (candidates.find(usable) ?? info.title).trim();
  };

  const artist = pick("artist", ai.artist, info.artist, info.channel, info.uploader);
  const title = pick("title", ai.title, info.track, info.title);

  // One-off uploads are their own single: album = title, unless the video or the
  // user's hint names a real album. The AI alone tends to offer the channel name.
  const albumNamed = usable(info.album) || Boolean(opts.hint);
  const album = albumNamed && usable(ai.album) ? ai.album.trim() : usable(info.album) ? info.album.trim() : title;

  const thisYear = new Date().getFullYear();
  const aiYear = typeof ai.year === "number" && ai.year >= 1900 && ai.year <= thisYear ? ai.year : undefined;
  if (!aiYear) fallbacks.push("year");
  const uploadYear = info.upload_date ? Number(info.upload_date.slice(0, 4)) : undefined;
  const year = aiYear ?? info.release_year ?? uploadYear;

  return { tags: { artist, title, album, year }, fallbacks };
}
