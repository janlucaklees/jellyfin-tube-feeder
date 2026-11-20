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

beforeEach(async () => {
  libraryDir = await mkdtemp(join(tmpdir(), "pipeline-test-"));
  written = [];
  known = new Set();
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
    writeMp3: async (audio, _cover, record, target) => {
      written.push(record);
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
