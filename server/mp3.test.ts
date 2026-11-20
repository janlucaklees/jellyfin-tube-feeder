import { $ } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCover, readSong, retag, writeMp3 } from "./mp3";

let dir: string;
let audio: string;
let cover: string;

const record = {
  artist: "Ida im Liederkasten",
  title: "Hallo du!",
  album: "Hallo du!",
  year: 2024,
  videoId: "F98x5f0ITKg",
  sourceUrl: "https://www.youtube.com/watch?v=F98x5f0ITKg",
  added: "2026-11-20T10:00:00.000Z",
  fallbacks: ["year" as const],
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mp3-test-"));
  audio = join(dir, "in.mp3");
  cover = join(dir, "in.jpg");
  await $`ffmpeg -loglevel error -f lavfi -i anullsrc=r=44100:cl=mono -t 1 -q:a 9 ${audio}`.quiet();
  await $`ffmpeg -loglevel error -f lavfi -i color=c=red:s=160x90 -frames:v 1 ${cover}`.quiet();
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("writeMp3 then readSong round-trips tags and the app's own fields", async () => {
  const target = join(dir, "out.mp3");
  await writeMp3(audio, cover, record, target);

  expect(await readSong(target)).toEqual({ ...record, file: target });
});

test("the cover is cropped to a square", async () => {
  const target = join(dir, "square.mp3");
  await writeMp3(audio, cover, record, target);
  const jpg = join(dir, "square.jpg");
  await Bun.write(jpg, (await readCover(target))!);

  const size = await $`ffprobe -v error -show_entries stream=width,height -of csv=p=0 ${jpg}`.text();
  expect(size.trim()).toBe("90,90");
});

test("retag changes tags in place and keeps the cover", async () => {
  const target = join(dir, "retag.mp3");
  await writeMp3(audio, cover, record, target);

  await retag(target, { ...record, artist: "Ida", fallbacks: [] });

  const song = await readSong(target);
  expect(song?.artist).toBe("Ida");
  expect(song?.fallbacks).toEqual([]);
  expect(await readCover(target)).not.toBeNull();
});

test("a song without a year has no year", async () => {
  const target = join(dir, "noyear.mp3");
  await writeMp3(audio, null, { ...record, year: undefined }, target);

  expect((await readSong(target))?.year).toBeUndefined();
  expect(await readCover(target)).toBeNull();
});

test("readSong ignores MP3s the app did not create", async () => {
  expect(await readSong(audio)).toBeNull();
});
