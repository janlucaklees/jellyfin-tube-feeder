/**
 * Benchmarks AI tagging on real videos, so models can be compared.
 * Real network, real Ollama — deliberately not a unit test.
 *
 *   mise run bench                    # default model
 *   mise run bench qwen3:4b           # another model (pulled if missing)
 *   mise run bench gemma4:e2b --download   # also time download + MP3 writing
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../server/config";
import { writeMp3 } from "../server/mp3";
import { askOllama, resolveTags } from "../server/tagger";
import { download, fetchInfo } from "../server/youtube";
import cases from "./cases.json";

interface Case {
  url: string;
  artist: string | string[];
  title: string | string[];
  note: string;
}

const args = Bun.argv.slice(2);
const withDownload = args.includes("--download");
const model = args.find((a) => !a.startsWith("--")) ?? config.model;

const normal = (s: string) => s.normalize("NFC").trim().toLowerCase();
const matches = (got: string, expected: string | string[]) =>
  (Array.isArray(expected) ? expected : [expected]).some((e) => normal(e) === normal(got));
const seconds = (since: number) => ((performance.now() - since) / 1000).toFixed(1);

console.log(`Model ${model} at ${config.ollamaUrl}`);
const pull = await fetch(`${config.ollamaUrl}/api/pull`, { method: "POST", body: JSON.stringify({ model, stream: false }) });
if (!pull.ok) throw new Error(`Pulling ${model} failed: ${await pull.text()}`);

const ask = askOllama(config.ollamaUrl, model);
const rows: string[][] = [];
let ok = 0;
let aiTime = 0;

for (const c of cases as Case[]) {
  const info = await fetchInfo(c.url);
  const start = performance.now();
  const { tags, fallbacks } = await resolveTags(info, { ask });
  const took = (performance.now() - start) / 1000;
  aiTime += took;
  const good = matches(tags.artist, c.artist) && matches(tags.title, c.title);
  if (good) ok++;
  let extra = "";
  if (withDownload) {
    const dir = await mkdtemp(join(tmpdir(), "bench-"));
    const t = performance.now();
    const media = await download(c.url, dir);
    await writeMp3(media.audio, media.cover, { ...tags, videoId: info.id, sourceUrl: c.url, added: new Date().toISOString(), fallbacks }, join(dir, "out.mp3"));
    extra = ` +${seconds(t)}s dl`;
    await rm(dir, { recursive: true, force: true });
  }
  rows.push([good ? "ok " : "BAD", `${took.toFixed(1)}s${extra}`, `${tags.artist} — ${tags.title}`, fallbacks.length ? `fallback: ${fallbacks.join(",")}` : "", c.note]);
  console.log(rows.at(-1)!.join("  |  "));
}

console.log(`\n${model}: ${ok}/${cases.length} artist+title right, AI ${(aiTime / cases.length).toFixed(1)}s per song on average`);
process.exit(ok === cases.length ? 0 : 1);
