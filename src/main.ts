import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { resolveTags } from "./metadata";
import { writeMp3, targetPath } from "./mp3";
import { download, fetchInfo } from "./youtube";

const USAGE = `Usage: natatube <youtube-link> [--hint "what you know about the song"]

  --hint  Free text the AI uses together with the video info, e.g.
          --hint "Artist is Ida im Liederkasten, album Herbstlieder"`;

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: { hint: { type: "string", short: "h" }, help: { type: "boolean" } },
  allowPositionals: true,
});

const url = positionals[0];
if (values.help || !url || positionals.length > 1) {
  console.error(USAGE);
  process.exit(values.help ? 0 : 1);
}

const work = await mkdtemp(join(tmpdir(), "natatube-"));
try {
  console.log("Fetching video info…");
  const info = await fetchInfo(url);

  console.log("Working out the tags…");
  const { tags, sources } = await resolveTags(info, values.hint);

  console.log("Downloading audio and thumbnail…");
  const media = await download(url, work);

  const target = targetPath(process.cwd(), tags);
  await writeMp3(media.audio, media.thumbnail, tags, target);

  const flag = (key: keyof typeof sources) => (sources[key] === "fallback" ? "  (fallback — check this)" : "");
  console.log(`
Created: ${basename(target)}
  Artist: ${tags.artist}${flag("artist")}
  Title:  ${tags.title}${flag("title")}
  Album:  ${tags.album}${flag("album")}
  Year:   ${tags.year ?? "—"}${flag("year")}
  Video:  ${info.title} (${info.channel ?? info.uploader ?? "?"})`);

  if (Object.entries(sources).some(([key, source]) => key !== "year" && source === "fallback")) {
    console.log(`\nSome tags are guesses. If they're wrong, delete the file and rerun with a hint:
  natatube "${url}" --hint "Artist is …, title is …"`);
  }
} catch (error) {
  const err = error as { stderr?: Buffer; message: string };
  console.error(`natatube failed: ${err.stderr?.toString().trim() || err.message}`);
  process.exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
