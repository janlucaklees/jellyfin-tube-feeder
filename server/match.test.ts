import { expect, test } from "bun:test";
import { isExact, splitArtistTitle, type Candidate, type Wanted } from "./match";

const wanted: Wanted = { title: "Never Gonna Give You Up", artist: "Rick Astley", durationSec: 214 };
const found = (patch: Partial<Candidate>): Candidate => ({
  url: "https://music.youtube.com/watch?v=lYBUbBu4W08",
  title: "Never Gonna Give You Up",
  artists: ["Rick Astley"],
  durationSec: 213.6,
  source: "YouTube Music",
  ...patch,
});

test("the same title, artist and length is exact, whatever the case and punctuation", () => {
  expect(isExact(wanted, found({}))).toBe(true);
  expect(isExact(wanted, found({ title: "never gonna give you up!", artists: ["RICK ASTLEY"] }))).toBe(true);
});

test("a different song of about the same length is not exact", () => {
  // A real result for this search: 210 s, within the tolerance, but another song.
  expect(isExact(wanted, found({ title: "I'm Never Gonna Give You Up", artists: ["Frank Stallone", "Cynthia Rhodes"], durationSec: 210 }))).toBe(false);
  expect(isExact(wanted, found({ title: "Never Gonna Give You Up (Funny Indian Remix)" }))).toBe(false);
});

test("the right song by someone else, or of another length, is not exact", () => {
  expect(isExact(wanted, found({ artists: ["Ruan Elias"] }))).toBe(false);
  expect(isExact(wanted, found({ durationSec: 30 }))).toBe(false); // a preview snippet
  expect(isExact(wanted, found({ durationSec: 218 }))).toBe(false);
  expect(isExact(wanted, found({ durationSec: undefined }))).toBe(false);
});

test("featured artists may or may not be repeated in the title", () => {
  const feat: Wanted = { title: "expectations (feat. Chappell Roan)", artist: "Olivia Rodrigo, Chappell Roan", durationSec: 200 };
  expect(isExact(feat, found({ title: "expectations", artists: ["Olivia Rodrigo", "Chappell Roan"], durationSec: 201 }))).toBe(true);
  expect(isExact(feat, found({ title: "expectations (feat. Chappell Roan)", artists: ["Olivia Rodrigo"], durationSec: 199 }))).toBe(true);
});

test("the first artist must match as whole words", () => {
  const multi: Wanted = { title: "Dai Dai", artist: "Shakira, Burna Boy", durationSec: 223 };
  expect(isExact(multi, found({ title: "Dai Dai", artists: ["Shakira", "Burna Boy"], durationSec: 223 }))).toBe(true);
  expect(isExact(multi, found({ title: "Dai Dai", artists: ["Shak"], durationSec: 223 }))).toBe(false);
  expect(isExact(multi, found({ title: "Dai Dai", artists: [], durationSec: 223 }))).toBe(false);
});

test("a SoundCloud title carrying the artist is split, other dashes are left alone", () => {
  const sc = found({ title: "Rick Astley - Never Gonna Give You Up", artists: ["Some Label"], source: "SoundCloud" });
  const split = splitArtistTitle(sc, wanted);
  expect(split).toMatchObject({ title: "Never Gonna Give You Up", artists: ["Rick Astley"] });
  expect(isExact(wanted, split)).toBe(true);

  const other = found({ title: "Intro - Live", artists: ["Rick Astley"] });
  expect(splitArtistTitle(other, wanted)).toBe(other);
});
