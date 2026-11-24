/**
 * The orchestrator: turns pasted links into jobs and runs them one at a time,
 * a YouTube link through youtube → tagger → mp3 → library, a Spotify link through
 * spotify → search → mp3 → library. Jobs live in memory only; a restart forgets
 * them, the finished songs are on disk.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PathTags } from "./library";
import type { SongRecord } from "./mp3";
import type { Resolved } from "./tagger";
import { parseLinks, type Source } from "./links";
import type { Wanted } from "./match";
import type { SpotifyTrack } from "./spotify";
import type { VideoInfo } from "./youtube";

export type JobState = "queued" | "fetching" | "tagging" | "matching" | "downloading" | "writing" | "done" | "duplicate" | "failed";

export interface Job {
  id: string;
  url: string;
  /** The YouTube video id or Spotify track id. */
  videoId: string;
  source: Source;
  state: JobState;
  /** The video's title, once known. */
  title?: string;
  error?: string;
  /** Where the finished song landed. */
  songFile?: string;
}

export type PipelineEvent = { type: "job"; job: Job } | { type: "job-removed"; id: string } | { type: "song"; file: string };

export interface PipelineDeps {
  libraryDir: string;
  fetchInfo(url: string): Promise<VideoInfo>;
  resolveTags(info: VideoInfo): Promise<Resolved>;
  download(url: string, dir: string, opts?: { thumbnail?: boolean }): Promise<{ audio: string; cover: string | null }>;
  fetchTrack(id: string): Promise<SpotifyTrack>;
  /** The URL of a recording that exactly matches the Spotify song; throws when there is none. */
  findAudio(wanted: Wanted): Promise<string>;
  downloadCover(url: string | undefined, dir: string): Promise<string | null>;
  writeMp3(audio: string, cover: string | null, record: SongRecord, target: string): Promise<void>;
  place(libraryDir: string, file: string, tags: PathTags): Promise<string>;
  /** Whether the library already holds this video. */
  hasVideo(videoId: string): boolean;
  now?(): string;
}

const ACTIVE: JobState[] = ["queued", "fetching", "tagging", "matching", "downloading", "writing"];
const FINISHED: JobState[] = ["done", "duplicate"];

export function createPipeline(deps: PipelineDeps) {
  const jobs: Job[] = [];
  const listeners = new Set<(event: PipelineEvent) => void>();
  let running: Promise<void> | null = null;

  // A listener is an open page's stream; one that throws (closed tab) must not stop the queue.
  const emit = (event: PipelineEvent) =>
    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error("A pipeline listener failed:", error);
      }
    });
  const update = (job: Job, patch: Partial<Job>) => {
    Object.assign(job, patch);
    emit({ type: "job", job });
  };

  async function run(job: Job): Promise<void> {
    let work: string | undefined;
    try {
      if (deps.hasVideo(job.videoId)) return update(job, { state: "duplicate" });
      work = await mkdtemp(join(tmpdir(), "tubefeeder-"));
      update(job, { state: "fetching", error: undefined });
      const { tags, fallbacks, media } = job.source === "spotify" ? await fromSpotify(job, work) : await fromYoutube(job, work);
      update(job, { state: "writing" });
      const record: SongRecord = {
        ...tags,
        videoId: job.videoId,
        sourceUrl: job.url,
        added: deps.now?.() ?? new Date().toISOString(),
        fallbacks,
      };
      const tagged = join(work, "song.mp3");
      await deps.writeMp3(media.audio, media.cover, record, tagged);
      const file = await deps.place(deps.libraryDir, tagged, tags);
      emit({ type: "song", file });
      update(job, { state: "done", songFile: file });
    } catch (error) {
      const err = error as { stderr?: Buffer; message: string };
      update(job, { state: "failed", error: err.stderr?.toString().trim() || err.message });
    } finally {
      if (work) await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  type Prepared = Resolved & { media: { audio: string; cover: string | null } };

  async function fromYoutube(job: Job, work: string): Promise<Prepared> {
    const info = await deps.fetchInfo(job.url);
    update(job, { state: "tagging", title: info.title });
    const resolved = await deps.resolveTags(info);
    update(job, { state: "downloading" });
    return { ...resolved, media: await deps.download(job.url, work) };
  }

  // Spotify knows the tags; only the audio has to come from somewhere else.
  async function fromSpotify(job: Job, work: string): Promise<Prepared> {
    const track = await deps.fetchTrack(job.videoId);
    update(job, { state: "matching", title: `${track.artist} – ${track.title}` });
    const audioUrl = await deps.findAudio(track);
    update(job, { state: "downloading" });
    const { audio } = await deps.download(audioUrl, work, { thumbnail: false });
    const cover = await deps.downloadCover(track.coverUrl, work);
    const { artist, title, album, year } = track;
    return { tags: { artist, title, album, ...(year ? { year } : {}) }, fallbacks: [], media: { audio, cover } };
  }

  function kick(): void {
    if (running) return;
    running = (async () => {
      try {
        for (let job = next(); job; job = next()) await run(job);
      } finally {
        running = null;
      }
    })();
  }

  const next = () => jobs.find((job) => job.state === "queued");

  return {
    /** Queues every new video linked in `text` and returns the jobs it created or re-queued. */
    enqueue(text: string): Job[] {
      const queued: Job[] = [];
      for (const { videoId, url, source } of parseLinks(text)) {
        const existing = jobs.find((job) => job.videoId === videoId);
        // A finished job is run again only once its song has left the library (deleted).
        const rerun = existing && (existing.state === "failed" || (FINISHED.includes(existing.state) && !deps.hasVideo(videoId)));
        if (existing && !rerun) continue;
        const job = existing ?? { id: crypto.randomUUID(), url, videoId, source, state: "queued" as JobState };
        if (!existing) jobs.push(job);
        update(job, { state: "queued", error: undefined });
        queued.push(job);
      }
      kick();
      return queued;
    },

    retry(id: string): void {
      const job = jobs.find((j) => j.id === id);
      if (job?.state !== "failed") return;
      update(job, { state: "queued", error: undefined });
      kick();
    },

    /** Removes a job that is no longer running. */
    dismiss(id: string): void {
      const index = jobs.findIndex((j) => j.id === id);
      if (index < 0 || ACTIVE.includes(jobs[index]!.state)) return;
      jobs.splice(index, 1);
      emit({ type: "job-removed", id });
    },

    jobs: (): Job[] => jobs.map((job) => ({ ...job })),

    on(listener: (event: PipelineEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Resolves once no job is queued or running. */
    async idle(): Promise<void> {
      while (running) await running;
    },
  };
}

export type Pipeline = ReturnType<typeof createPipeline>;
