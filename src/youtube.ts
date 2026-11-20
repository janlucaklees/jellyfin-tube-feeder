import { $ } from "bun";

/** The subset of yt-dlp's video info that natatube uses. */
export interface VideoInfo {
  id: string;
  title: string;
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
const YT_DLP = ["yt-dlp", "--js-runtimes", "bun", "--no-playlist"];

export async function fetchInfo(url: string): Promise<VideoInfo> {
  const json = await $`${YT_DLP} --skip-download --dump-json -- ${url}`.quiet().text();
  return JSON.parse(json) as VideoInfo;
}

/** Downloads the audio as MP3 and the thumbnail as JPG into `dir`. */
export async function download(url: string, dir: string): Promise<{ audio: string; thumbnail: string }> {
  await $`${YT_DLP} -x --audio-format mp3 --audio-quality 0 --write-thumbnail --convert-thumbnails jpg -o ${`${dir}/media.%(ext)s`} -- ${url}`.quiet();
  return { audio: `${dir}/media.mp3`, thumbnail: `${dir}/media.jpg` };
}
