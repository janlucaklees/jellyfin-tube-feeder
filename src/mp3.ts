import { $ } from "bun";
import { existsSync } from "node:fs";
import type { Tags } from "./metadata";

/** Writes `audio` with tags and a square-cropped cover to `target`. */
export async function writeMp3(audio: string, thumbnail: string, tags: Tags, target: string): Promise<void> {
  const cover = `${thumbnail}.square.jpg`;
  await $`ffmpeg -y -loglevel error -i ${thumbnail} -vf ${"crop=min(iw\\,ih):min(iw\\,ih)"} ${cover}`.quiet();

  const metadata = [
    ["title", tags.title],
    ["artist", tags.artist],
    ["album_artist", tags.artist],
    ["album", tags.album],
    ...(tags.year ? [["date", String(tags.year)]] : []),
  ].flatMap(([key, value]) => ["-metadata", `${key}=${value}`]);

  await $`ffmpeg -y -loglevel error -i ${audio} -i ${cover} -map 0:a -map 1:v -c copy -id3v2_version 3 ${metadata} -metadata:s:v title=${"Album cover"} -metadata:s:v comment=${"Cover (front)"} ${target}`.quiet();
}

/** `Artist - Title.mp3`, safe for any filesystem, never overwriting an existing file. */
export function targetPath(dir: string, tags: Tags): string {
  const base = `${tags.artist} - ${tags.title}`
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  let candidate = `${dir}/${base}.mp3`;
  for (let n = 2; existsSync(candidate); n++) candidate = `${dir}/${base} (${n}).mp3`;
  return candidate;
}
