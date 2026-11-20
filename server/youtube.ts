/** YouTube via yt-dlp: which videos a text names, their info, their audio and thumbnail. */
import { $ } from "bun";
import { join } from "node:path";

/** The subset of yt-dlp's video info that the app uses. */
export interface VideoInfo {
  id: string;
  title: string;
  webpage_url?: string;
  channel?: string;
  uploader?: string;
  description?: string;
  tags?: string[];
  /** Set by YouTube for music uploads ("Provided to YouTube by ..."). */
  artist?: string;
  track?: string;
  album?: string;
  release_year?: number;
  upload_date?: string;
}

// yt-dlp needs a JS runtime for YouTube; bun is what the image has.
const YT_DLP = ["yt-dlp", "--js-runtimes", "bun", "--no-playlist", "--no-progress"];

export async function fetchInfo(url: string): Promise<VideoInfo> {
  const json = await $`${YT_DLP} --skip-download --dump-json -- ${url}`.quiet().text();
  return JSON.parse(json) as VideoInfo;
}

/** Downloads best audio as MP3 and the thumbnail as JPEG into `dir`. */
export async function download(url: string, dir: string): Promise<{ audio: string; cover: string | null }> {
  await $`${YT_DLP} -x --audio-format mp3 --audio-quality 0 --write-thumbnail --convert-thumbnails jpg -o ${join(dir, "media.%(ext)s")} -- ${url}`.quiet();
  const cover = join(dir, "media.jpg");
  return { audio: join(dir, "media.mp3"), cover: (await Bun.file(cover).exists()) ? cover : null };
}
