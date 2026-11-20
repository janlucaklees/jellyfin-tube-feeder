/** Wires the modules together and starts the server. */
import { join } from "node:path";
import { config } from "./config";
import { place } from "./library";
import { writeMp3 } from "./mp3";
import { createPipeline } from "./pipeline";
import { createSongIndex } from "./songs";
import { askOllama, resolveTags } from "./tagger";
import { createApp } from "./web";
import { download, fetchInfo } from "./youtube";

const ask = askOllama(config.ollamaUrl, config.model);

const songs = createSongIndex(config.libraryDir);
await songs.load();
console.log(`Library ${config.libraryDir}: ${songs.list().length} songs`);

const pipeline = createPipeline({
  libraryDir: config.libraryDir,
  fetchInfo,
  resolveTags: (info) => resolveTags(info, { ask }),
  download,
  writeMp3,
  place,
  hasVideo: songs.has,
});
pipeline.on((event) => {
  if (event.type === "song") songs.add(event.file).catch((e) => console.error(`Reading ${event.file} failed:`, e));
  if (event.type === "job" && event.job.state === "failed") console.error(`${event.job.url} failed: ${event.job.error}`);
});

const app = createApp({
  songs,
  pipeline,
  uiDir: join(import.meta.dir, "..", "dist", "ui"),
  async askAgain(videoId, hint) {
    const song = songs.get(videoId)!;
    const info = await fetchInfo(song.sourceUrl);
    const { tags, fallbacks } = await resolveTags(info, { hint, ask });
    return (await songs.update(videoId, tags, fallbacks))!;
  },
});

Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 0 });
console.log(`Listening on :${config.port}, model ${config.model} at ${config.ollamaUrl}`);

/** Makes sure Ollama has the model, retrying while Ollama is still starting. */
async function ensureModel(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`${config.ollamaUrl}/api/pull`, {
        method: "POST",
        body: JSON.stringify({ model: config.model, stream: false }),
      });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      console.log(`Model ${config.model} is ready`);
      return;
    } catch (error) {
      if (attempt % 10 === 1) console.error(`Model ${config.model} not ready yet (${(error as Error).message}), retrying`);
      await Bun.sleep(10_000);
    }
  }
}
void ensureModel();
