/**
 * MP3 files as records: ffmpeg writes the tags (the app's own fields as TXXX
 * frames) and the cover, ffprobe reads them back. The MP3 is the only state.
 */
import { $ } from "bun";
import { rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Song, TagName } from "./song";

export type SongRecord = Omit<Song, "file">;

const FIELD = {
  videoId: "TUBEFEEDER_VIDEO_ID",
  sourceUrl: "TUBEFEEDER_SOURCE_URL",
  added: "TUBEFEEDER_ADDED",
  fallbacks: "TUBEFEEDER_FALLBACKS",
} as const;

function metadataArgs(song: SongRecord): string[] {
  const pairs: [string, string | undefined][] = [
    ["title", song.title],
    ["artist", song.artist],
    ["album_artist", song.artist],
    ["album", song.album],
    ["date", song.year?.toString()],
    [FIELD.videoId, song.videoId],
    [FIELD.sourceUrl, song.sourceUrl],
    [FIELD.added, song.added],
    [FIELD.fallbacks, song.fallbacks.join(",")],
  ];
  return pairs.filter(([, v]) => v).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]);
}

const COVER_ARGS = ["-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)"];

/** Writes `audio` with `song`'s tags and, if given, `cover` cropped to a centred square. */
export async function writeMp3(audio: string, cover: string | null, song: SongRecord, target: string): Promise<void> {
  if (cover) {
    const square = `${cover}.square.jpg`;
    await $`ffmpeg -y -loglevel error -i ${cover} -vf ${"crop=min(iw\\,ih):min(iw\\,ih)"} ${square}`.quiet();
    await $`ffmpeg -y -loglevel error -i ${audio} -i ${square} -map 0:a -map 1:v -c copy -id3v2_version 3 ${metadataArgs(song)} ${COVER_ARGS} ${target}`.quiet();
  } else {
    await $`ffmpeg -y -loglevel error -i ${audio} -map 0:a -c copy -id3v2_version 3 ${metadataArgs(song)} ${target}`.quiet();
  }
}

/** Replaces all tags of `file` in place, keeping audio and cover untouched. */
export async function retag(file: string, song: SongRecord): Promise<void> {
  const temp = join(dirname(file), `.${basename(file)}.tmp`);
  const hasCover = (await readCoverStream(file)) !== null;
  await $`ffmpeg -y -loglevel error -i ${file} -map 0 -c copy -map_metadata -1 -id3v2_version 3 ${metadataArgs(song)} ${hasCover ? COVER_ARGS : []} -f mp3 ${temp}`.quiet();
  await rename(temp, file);
}

async function readCoverStream(file: string): Promise<number | null> {
  const out = await $`ffprobe -v error -select_streams v -show_entries stream=index -of csv=p=0 ${file}`.quiet().text();
  const index = out.trim().split("\n")[0];
  return index ? Number(index) : null;
}

/** The song's record, or null when the MP3 was not made by this app. */
export async function readSong(file: string): Promise<Song | null> {
  const out = await $`ffprobe -v error -show_entries format_tags -of json ${file}`.quiet().json();
  const raw = (out.format?.tags ?? {}) as Record<string, string>;
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) tags[k.toUpperCase()] = v;

  const videoId = tags[FIELD.videoId];
  if (!videoId) return null;
  const year = Number.parseInt(tags.DATE ?? "", 10);
  return {
    file,
    artist: tags.ARTIST ?? "",
    title: tags.TITLE ?? "",
    album: tags.ALBUM ?? "",
    ...(Number.isFinite(year) ? { year } : {}),
    videoId,
    sourceUrl: tags[FIELD.sourceUrl] ?? "",
    added: tags[FIELD.added] ?? "",
    fallbacks: (tags[FIELD.fallbacks] ?? "").split(",").filter(Boolean) as TagName[],
  };
}

/** The embedded cover as JPEG bytes, or null. */
export async function readCover(file: string): Promise<Uint8Array | null> {
  const index = await readCoverStream(file);
  if (index === null) return null;
  const bytes = await $`ffmpeg -loglevel error -i ${file} -map 0:${index} -c copy -f image2pipe -`.quiet().arrayBuffer();
  return new Uint8Array(bytes);
}
