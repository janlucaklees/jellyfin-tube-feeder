import type { VideoInfo } from "./youtube";

export interface Tags {
  artist: string;
  title: string;
  album: string;
  year?: number;
}

export type Source = "ai" | "fallback";

export interface Result {
  tags: Tags;
  /** Where each field came from, so the report can flag guesses. */
  sources: Record<keyof Tags, Source>;
}

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.NATATUBE_MODEL ?? "gemma4:e2b";

const SYSTEM_PROMPT = `You turn YouTube video information into clean MP3 tags for a family music library.
Rules:
- artist: the performing artist or band. If the title doesn't name one, use the channel name, minus generic suffixes like "- Kinderlieder" or "- Musik für Dich".
- title: only the song name. Remove artist names, "Official Video", "Lyrics", "HD", "Kinderlieder zum Mitsingen", channel names, emojis and similar noise. Keep version info like "(Version 2015)".
- album: the album if stated, otherwise repeat the title.
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

async function askModel(info: VideoInfo, hint?: string): Promise<Partial<Tags>> {
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

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
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
  if (!response.ok) throw new Error(`Ollama (${MODEL}) answered ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as { message: { content: string } };
  return JSON.parse(body.message.content) as Partial<Tags>;
}

const PLACEHOLDER = /^(unknown|unbekannt|n\/?a|none|null|undefined|-|\?+)$/i;

function usable(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !PLACEHOLDER.test(value.trim());
}

/** Works out the tags; whatever the model gets wrong falls back to what YouTube says. */
export async function resolveTags(info: VideoInfo, hint?: string): Promise<Result> {
  let ai: Partial<Tags> = {};
  try {
    ai = await askModel(info, hint);
  } catch (error) {
    console.error(`AI failed, using fallbacks: ${(error as Error).message}`);
  }

  const pick = (value: unknown, ...fallbacks: (string | undefined)[]): [string, Source] => {
    if (usable(value)) return [value.trim(), "ai"];
    return [(fallbacks.find(usable) ?? info.title).trim(), "fallback"];
  };

  const [artist, artistSource] = pick(ai.artist, info.artist, info.channel, info.uploader);
  const [title, titleSource] = pick(ai.title, info.track, info.title);
  const [album, albumSource] = pick(ai.album, info.album, title);

  const uploadYear = info.upload_date ? Number(info.upload_date.slice(0, 4)) : undefined;
  const thisYear = new Date().getFullYear();
  const aiYear = typeof ai.year === "number" && ai.year >= 1900 && ai.year <= thisYear ? ai.year : undefined;
  const year = aiYear ?? info.release_year ?? uploadYear;

  return {
    tags: { artist, title, album, year },
    sources: { artist: artistSource, title: titleSource, album: albumSource, year: aiYear ? "ai" : "fallback" },
  };
}
