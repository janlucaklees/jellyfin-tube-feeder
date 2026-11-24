import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { place } from "./library";
import { createPipeline, type Job, type PipelineDeps, type PipelineEvent } from "./pipeline";
import type { SongRecord } from "./mp3";
import type { VideoInfo } from "./youtube";

let libraryDir: string;
let written: SongRecord[];
let known: Set<string>;
let downloadedCovers: (string | undefined)[];
let writtenCovers: (string | null)[];

beforeEach(async () => {
  libraryDir = await mkdtemp(join(tmpdir(), "pipeline-test-"));
  written = [];
  known = new Set();
  downloadedCovers = [];
  writtenCovers = [];
});
afterEach(async () => {
  await rm(libraryDir, { recursive: true, force: true });
});

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    libraryDir,
    fetchInfo: async (url) => ({ id: url.slice(-11), title: `Video ${url.slice(-11)}`, channel: "Chan" }) as VideoInfo,
    resolveTags: async (info) => ({ tags: { artist: "Chan", title: info.title, album: info.title }, fallbacks: [] }),
    download: async (_url, dir) => {
      await writeFile(join(dir, "media.mp3"), "audio");
      return { audio: join(dir, "media.mp3"), cover: null };
    },
    fetchTrack: async (id) => ({ id, title: "Dai Dai", artist: "Shakira, Burna Boy", album: "Las Mujeres", year: 2026, durationSec: 223, coverUrl: "https://i.scdn.co/c" }),
    findAudio: async () => "https://music.youtube.com/watch?v=matchedaaaa",
    downloadCover: async (url, dir) => {
      downloadedCovers.push(url);
      await writeFile(join(dir, "cover.jpg"), "jpg");
      return join(dir, "cover.jpg");
    },
    writeMp3: async (audio, cover, record, target) => {
      written.push(record);
      writtenCovers.push(cover);
      await writeFile(target, await Bun.file(audio).text());
    },
    place,
    hasVideo: (id) => known.has(id),
    now: () => "2026-11-20T10:00:00.000Z",
    ...overrides,
  };
}

const link = (id: string) => `https://youtu.be/${id}`;

test("runs jobs one after another through every stage into the library", async () => {
  const events: PipelineEvent[] = [];
  const pipeline = createPipeline(deps());
  pipeline.on((e) => events.push(structuredClone(e)));

  pipeline.enqueue(`${link("aaaaaaaaaaa")}\n${link("bbbbbbbbbbb")}`);
  await pipeline.idle();

  const states = events.filter((e) => e.type === "job" && e.job.videoId === "aaaaaaaaaaa").map((e) => (e as { job: Job }).job.state);
  expect(states).toEqual(["queued", "fetching", "tagging", "downloading", "writing", "done"]);
  const firstDone = events.findIndex((e) => e.type === "job" && e.job.videoId === "aaaaaaaaaaa" && e.job.state === "done");
  const secondFetching = events.findIndex((e) => e.type === "job" && e.job.videoId === "bbbbbbbbbbb" && e.job.state === "fetching");
  expect(secondFetching).toBeGreaterThan(firstDone);

  const file = join(libraryDir, "Chan", "Video aaaaaaaaaaa", "Chan - Video aaaaaaaaaaa.mp3");
  expect(existsSync(file)).toBe(true);
  expect(events).toContainEqual({ type: "song", file });
  expect(written[0]).toMatchObject({
    videoId: "aaaaaaaaaaa",
    sourceUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    added: "2026-11-20T10:00:00.000Z",
  });
});

test("the same video twice in one paste becomes one job", () => {
  const pipeline = createPipeline(deps());
  const jobs = pipeline.enqueue(`${link("aaaaaaaaaaa")} https://www.youtube.com/watch?v=aaaaaaaaaaa`);
  expect(jobs).toHaveLength(1);
});

test("a video already in the library is not downloaded again", async () => {
  known.add("aaaaaaaaaaa");
  const pipeline = createPipeline(deps());
  const [job] = pipeline.enqueue(link("aaaaaaaaaaa"));
  await pipeline.idle();
  expect(pipeline.jobs().find((j) => j.id === job!.id)?.state).toBe("duplicate");
  expect(written).toHaveLength(0);
});

test("a video that is already queued is not queued again", () => {
  const pipeline = createPipeline(deps());
  pipeline.enqueue(link("aaaaaaaaaaa"));
  expect(pipeline.enqueue(link("aaaaaaaaaaa"))).toHaveLength(0);
});

test("a failing job reports its error and the next one still runs", async () => {
  const pipeline = createPipeline(
    deps({
      download: async (url, dir) => {
        if (url.endsWith("aaaaaaaaaaa")) throw new Error("Video unavailable");
        await writeFile(join(dir, "media.mp3"), "audio");
        return { audio: join(dir, "media.mp3"), cover: null };
      },
    }),
  );
  pipeline.enqueue(`${link("aaaaaaaaaaa")} ${link("bbbbbbbbbbb")}`);
  await pipeline.idle();

  const [a, b] = pipeline.jobs();
  expect(a).toMatchObject({ state: "failed", error: "Video unavailable" });
  expect(b?.state).toBe("done");
});

test("retry re-runs a failed job, dismiss removes a finished one", async () => {
  let fail = true;
  const pipeline = createPipeline(
    deps({
      fetchInfo: async (url) => {
        if (fail) throw new Error("network down");
        return { id: url.slice(-11), title: "T" } as VideoInfo;
      },
    }),
  );
  const [job] = pipeline.enqueue(link("aaaaaaaaaaa"));
  await pipeline.idle();
  expect(pipeline.jobs()[0]?.state).toBe("failed");

  fail = false;
  pipeline.retry(job!.id);
  await pipeline.idle();
  expect(pipeline.jobs()[0]?.state).toBe("done");

  pipeline.dismiss(job!.id);
  expect(pipeline.jobs()).toHaveLength(0);
});

test("pasting a failed video again retries it instead of adding a second card", async () => {
  let fail = true;
  const pipeline = createPipeline(
    deps({
      fetchInfo: async (url) => {
        if (fail) throw new Error("network down");
        return { id: url.slice(-11), title: "T" } as VideoInfo;
      },
    }),
  );
  pipeline.enqueue(link("aaaaaaaaaaa"));
  await pipeline.idle();
  fail = false;
  pipeline.enqueue(link("aaaaaaaaaaa"));
  await pipeline.idle();
  expect(pipeline.jobs()).toHaveLength(1);
  expect(pipeline.jobs()[0]?.state).toBe("done");
});

test("a listener that throws does not stall the queue", async () => {
  const pipeline = createPipeline(deps());
  pipeline.on(() => {
    throw new Error("closed stream");
  });
  pipeline.enqueue(link("aaaaaaaaaaa"));
  await pipeline.idle();
  pipeline.enqueue(link("bbbbbbbbbbb"));
  await pipeline.idle();
  expect(pipeline.jobs().map((j) => j.state)).toEqual(["done", "done"]);
});

test("an error outside a job's own steps does not stall the queue", async () => {
  let explode = true;
  const pipeline = createPipeline(
    deps({
      hasVideo: () => {
        if (explode) throw new Error("index broken");
        return false;
      },
    }),
  );
  pipeline.enqueue(link("aaaaaaaaaaa"));
  await pipeline.idle();
  expect(pipeline.jobs()[0]?.state).toBe("failed");
  explode = false;
  pipeline.enqueue(link("bbbbbbbbbbb"));
  await pipeline.idle();
  expect(pipeline.jobs()[1]?.state).toBe("done");
});

test("a song deleted from the library can be added again", async () => {
  const pipeline = createPipeline(deps());
  pipeline.enqueue(link("aaaaaaaaaaa"));
  await pipeline.idle();
  expect(pipeline.enqueue(link("aaaaaaaaaaa"))).toHaveLength(1);
  await pipeline.idle();
  expect(pipeline.jobs()).toHaveLength(1);
  expect(written).toHaveLength(2);
});

const spotify = (id: string) => `https://open.spotify.com/track/${id}`;

test("a Spotify song is tagged from Spotify, its exact match downloaded without thumbnail", async () => {
  const events: PipelineEvent[] = [];
  const downloads: { url: string; thumbnail?: boolean }[] = [];
  const pipeline = createPipeline(
    deps({
      fetchInfo: async () => {
        throw new Error("no YouTube info for a Spotify song");
      },
      resolveTags: async () => {
        throw new Error("no AI tagging for a Spotify song");
      },
      download: async (url, dir, opts) => {
        downloads.push({ url, thumbnail: opts?.thumbnail });
        await writeFile(join(dir, "media.mp3"), "audio");
        return { audio: join(dir, "media.mp3"), cover: null };
      },
    }),
  );
  pipeline.on((e) => events.push(structuredClone(e)));

  pipeline.enqueue(spotify("0kosUz0jePvjiz4ctmR6wL"));
  await pipeline.idle();

  const states = events.filter((e) => e.type === "job").map((e) => (e as { job: Job }).job.state);
  expect(states).toEqual(["queued", "fetching", "matching", "downloading", "writing", "done"]);
  expect(pipeline.jobs()[0]).toMatchObject({ source: "spotify", title: "Shakira, Burna Boy – Dai Dai" });
  expect(downloads).toEqual([{ url: "https://music.youtube.com/watch?v=matchedaaaa", thumbnail: false }]);
  expect(downloadedCovers).toEqual(["https://i.scdn.co/c"]);
  expect(writtenCovers[0]).toEndWith("cover.jpg");
  expect(written[0]).toMatchObject({
    artist: "Shakira, Burna Boy",
    title: "Dai Dai",
    album: "Las Mujeres",
    year: 2026,
    videoId: "0kosUz0jePvjiz4ctmR6wL",
    sourceUrl: spotify("0kosUz0jePvjiz4ctmR6wL"),
    fallbacks: [],
  });
  expect(existsSync(join(libraryDir, "Shakira, Burna Boy", "Las Mujeres", "Shakira, Burna Boy - Dai Dai.mp3"))).toBe(true);
});

test("a Spotify song without an exact match fails with what was found", async () => {
  const pipeline = createPipeline(
    deps({
      findAudio: async () => {
        throw new Error("Keine exakt passende Aufnahme auf YouTube Music oder SoundCloud gefunden.");
      },
    }),
  );
  pipeline.enqueue(spotify("0kosUz0jePvjiz4ctmR6wL"));
  await pipeline.idle();
  expect(pipeline.jobs()[0]).toMatchObject({ state: "failed", error: expect.stringContaining("Keine exakt passende") });
  expect(written).toHaveLength(0);
});
