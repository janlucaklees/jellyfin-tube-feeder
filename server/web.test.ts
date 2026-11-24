import { $ } from "bun";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMp3 } from "./mp3";
import { createPipeline } from "./pipeline";
import { createSongIndex, type SongIndex } from "./songs";
import { createApp } from "./web";

let libraryDir: string;
let songs: SongIndex;
let app: ReturnType<typeof createApp>;
let asked: { videoId: string; hint: string }[];

async function addSong(videoId: string, artist: string, title: string, added: string, sourceUrl = `https://youtu.be/${videoId}`) {
  const dir = join(libraryDir, artist, title);
  await mkdir(dir, { recursive: true });
  const raw = join(libraryDir, `${videoId}.raw.mp3`);
  await $`ffmpeg -loglevel error -f lavfi -i anullsrc=r=44100:cl=mono -t 1 -q:a 9 ${raw}`.quiet();
  const file = join(dir, `${artist} - ${title}.mp3`);
  await writeMp3(raw, null, { artist, title, album: title, videoId, sourceUrl, added, fallbacks: ["artist"] }, file);
  await rm(raw);
  return file;
}

beforeEach(async () => {
  libraryDir = await mkdtemp(join(tmpdir(), "web-test-"));
  await addSong("aaaaaaaaaaa", "Ida", "Hallo du!", "2026-11-20T10:00:00.000Z");
  await addSong("bbbbbbbbbbb", "Ida", "Im Advent", "2026-11-20T11:00:00.000Z");
  songs = createSongIndex(libraryDir);
  await songs.load();
  asked = [];
  const pipeline = createPipeline({
    libraryDir,
    fetchInfo: async () => {
      throw new Error("offline");
    },
    resolveTags: async () => {
      throw new Error("unused");
    },
    download: async () => {
      throw new Error("unused");
    },
    fetchTrack: async () => {
      throw new Error("offline");
    },
    findAudio: async () => {
      throw new Error("unused");
    },
    downloadCover: async () => null,
    writeMp3: async () => {},
    place: async () => "",
    hasVideo: songs.has,
  });
  app = createApp({
    songs,
    pipeline,
    uiDir: join(libraryDir, "no-ui"),
    askAgain: async (videoId, hint) => {
      asked.push({ videoId, hint });
      return songs.get(videoId)!;
    },
  });
});
afterEach(async () => {
  await rm(libraryDir, { recursive: true, force: true });
});

const call = (method: string, path: string, body?: unknown) =>
  app.fetch(
    new Request(`http://app${path}`, {
      method,
      ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
    }),
  );

test("lists songs newest first", async () => {
  const list = await (await call("GET", "/api/songs")).json();
  expect(list.map((s: { title: string }) => s.title)).toEqual(["Im Advent", "Hallo du!"]);
});

test("an edit with an empty title is refused", async () => {
  const response = await call("PUT", "/api/songs/aaaaaaaaaaa", { artist: "Ida", title: " ", album: "x" });
  expect(response.status).toBe(400);
});

test("an edit retags the song, moves it and clears the fallback flags", async () => {
  const response = await call("PUT", "/api/songs/aaaaaaaaaaa", { artist: "Ida im Liederkasten", title: "Hallo du!", album: "Hallo du!", year: 2024 });
  expect(response.status).toBe(200);
  const song = await response.json();

  expect(song.file).toBe(join(libraryDir, "Ida im Liederkasten", "Hallo du!", "Ida im Liederkasten - Hallo du!.mp3"));
  expect(song.fallbacks).toEqual([]);
  expect(song.year).toBe(2024);
  expect(existsSync(join(libraryDir, "Ida", "Hallo du!"))).toBe(false);
  expect(songs.get("aaaaaaaaaaa")?.artist).toBe("Ida im Liederkasten");
});

test("an edit of an unknown song is a 404", async () => {
  expect((await call("PUT", "/api/songs/zzzzzzzzzzz", { artist: "a", title: "b", album: "c" })).status).toBe(404);
});

test("every change reports which files appeared and disappeared", async () => {
  const seen: unknown[] = [];
  songs.on((changes) => seen.push(changes));
  const before = songs.get("aaaaaaaaaaa")!.file;

  await call("PUT", "/api/songs/aaaaaaaaaaa", { artist: "Ida im Liederkasten", title: "Hallo du!", album: "Hallo du!" });
  const after = songs.get("aaaaaaaaaaa")!.file;
  await call("PUT", "/api/songs/aaaaaaaaaaa", { artist: "Ida im Liederkasten", title: "Hallo du!", album: "Hallo du!", year: 2024 });
  await call("DELETE", "/api/songs/aaaaaaaaaaa");

  expect(seen).toEqual([
    [
      { file: before, type: "Deleted" },
      { file: after, type: "Created" },
    ],
    [{ file: after, type: "Modified" }],
    [{ file: after, type: "Deleted" }],
  ]);
});

test("delete removes the file and the song", async () => {
  const file = songs.get("bbbbbbbbbbb")!.file;
  expect((await call("DELETE", "/api/songs/bbbbbbbbbbb")).status).toBe(204);
  expect(existsSync(file)).toBe(false);
  expect(songs.has("bbbbbbbbbbb")).toBe(false);
});

test("asking the AI again passes the hint on", async () => {
  expect((await call("POST", "/api/songs/aaaaaaaaaaa/ask", { hint: "Artist is Ida im Liederkasten" })).status).toBe(200);
  expect(asked).toEqual([{ videoId: "aaaaaaaaaaa", hint: "Artist is Ida im Liederkasten" }]);
});

test("posting links queues jobs", async () => {
  const response = await call("POST", "/api/jobs", { links: "https://youtu.be/ccccccccccc" });
  expect(response.status).toBe(202);
  expect((await response.json()).map((j: { videoId: string }) => j.videoId)).toEqual(["ccccccccccc"]);
});

test("health answers ok", async () => {
  expect((await call("GET", "/health")).status).toBe(200);
});

test("a Spotify song is reached by its track id and is not handed to the AI", async () => {
  const id = "0kosUz0jePvjiz4ctmR6wL";
  await addSong(id, "Shakira", "Dai Dai", "2026-11-24T10:00:00.000Z", `https://open.spotify.com/track/${id}`);
  await songs.load();

  const saved = await call("PUT", `/api/songs/${id}`, { artist: "Shakira", title: "Dai Dai", album: "Las Mujeres", year: 2026 });
  expect(saved.status).toBe(200);
  expect((await saved.json()).album).toBe("Las Mujeres");

  expect((await call("POST", `/api/songs/${id}/ask`, { hint: "anything" })).status).toBe(400);
  expect(asked).toEqual([]);
});
