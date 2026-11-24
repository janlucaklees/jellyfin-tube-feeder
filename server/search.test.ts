import { expect, test } from "bun:test";
import type { Candidate } from "./match";
import { findAudio } from "./search";

const wanted = { title: "Dai Dai", artist: "Shakira, Burna Boy", durationSec: 223 };
const hit = (patch: Partial<Candidate>): Candidate => ({
  url: "https://music.youtube.com/watch?v=x",
  title: "Dai Dai",
  artists: ["Shakira"],
  durationSec: 223,
  source: "YouTube Music",
  ...patch,
});

test("takes the first exact match, searching SoundCloud only when YouTube Music has none", async () => {
  let soundCloudAsked = false;
  const url = await findAudio(wanted, [
    async () => [hit({ url: "remix", title: "Dai Dai (Remix)" }), hit({ url: "yes" }), hit({ url: "later" })],
    async () => {
      soundCloudAsked = true;
      return [];
    },
  ]);
  expect(url).toBe("yes");
  expect(soundCloudAsked).toBe(false);

  expect(await findAudio(wanted, [async () => [], async () => [hit({ url: "sc", title: "Shakira - Dai Dai", artists: ["Label"] })]])).toBe("sc");
});

test("without an exact match it fails and lists what it found instead", async () => {
  const run = findAudio(wanted, [async () => [hit({ title: "Dai Dai (Live)", url: "https://music.youtube.com/watch?v=live" })], async () => []]);
  await expect(run).rejects.toThrow(/Keine exakt passende Aufnahme[\s\S]*Dai Dai \(Live\)/);
});

test("a failed search is reported, not mistaken for nothing found, and the next one still runs", async () => {
  const run = findAudio(wanted, [
    async () => {
      throw new Error("Suche auf YouTube Music fehlgeschlagen: Sign in to confirm you're not a bot");
    },
    async () => [hit({ url: "sc" })],
  ]);
  expect(await run).toBe("sc");

  const both = findAudio(wanted, [
    async () => {
      throw new Error("Suche auf YouTube Music fehlgeschlagen: offline");
    },
    async () => [],
  ]);
  await expect(both).rejects.toThrow(/Keine exakt passende[\s\S]*fehlgeschlagen: offline/);
});
