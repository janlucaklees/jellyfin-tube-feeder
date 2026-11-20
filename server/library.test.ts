import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMp3, place, remove, segment, songPath, uniquePath } from "./library";

describe("segment", () => {
  test("replaces characters that are unsafe in paths", () => {
    expect(segment("AC/DC")).toBe("AC_DC");
    expect(segment('What? "No": <x>|y*\\')).toBe("What_ _No__ _x__y__");
  });

  test("strips trailing dots and surrounding whitespace", () => {
    expect(segment("  Hallo du!...  ")).toBe("Hallo du!");
  });

  test("never returns an empty or dot-only name", () => {
    expect(segment("  ...  ")).toBe("_");
    expect(segment("")).toBe("_");
  });

  test("strips leading dots so no folder becomes hidden", () => {
    expect(segment(".38 Special")).toBe("38 Special");
    expect(segment("...Baby One More Time")).toBe("Baby One More Time");
  });

  test("caps the length", () => {
    expect(segment("a".repeat(300)).length).toBe(120);
  });
});

test("songPath builds Artist/Album/Artist - Title.mp3", () => {
  expect(songPath({ artist: "Ida", title: "Hallo du!", album: "Hallo du!" })).toBe(
    "Ida/Hallo du!/Ida - Hallo du!.mp3",
  );
});

describe("on disk", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "library-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("uniquePath appends a counter when the file exists", async () => {
    const file = join(dir, "A - B.mp3");
    expect(uniquePath(file)).toBe(file);
    await writeFile(file, "x");
    expect(uniquePath(file)).toBe(join(dir, "A - B (2).mp3"));
  });

  test("place moves a file into the layout and prunes emptied folders", async () => {
    const old = join(dir, "Old Artist", "Old Album", "Old Artist - Song.mp3");
    await mkdir(join(dir, "Old Artist", "Old Album"), { recursive: true });
    await writeFile(old, "x");

    const placed = await place(dir, old, { artist: "New", title: "Song", album: "Song" });

    expect(placed).toBe(join(dir, "New", "Song", "New - Song.mp3"));
    expect(existsSync(placed)).toBe(true);
    expect(existsSync(join(dir, "Old Artist"))).toBe(false);
    expect(existsSync(dir)).toBe(true);
  });

  test("place keeps a folder that still holds other songs", async () => {
    await mkdir(join(dir, "A", "X"), { recursive: true });
    await writeFile(join(dir, "A", "X", "A - one.mp3"), "1");
    await writeFile(join(dir, "A", "X", "A - two.mp3"), "2");

    await place(dir, join(dir, "A", "X", "A - one.mp3"), { artist: "B", title: "one", album: "one" });

    expect(existsSync(join(dir, "A", "X", "A - two.mp3"))).toBe(true);
  });

  test("place never overwrites an existing song", async () => {
    await mkdir(join(dir, "A", "S"), { recursive: true });
    await writeFile(join(dir, "A", "S", "A - S.mp3"), "existing");
    const incoming = join(dir, "incoming.mp3");
    await writeFile(incoming, "new");

    const placed = await place(dir, incoming, { artist: "A", title: "S", album: "S" });

    expect(placed).toBe(join(dir, "A", "S", "A - S (2).mp3"));
    expect(await Bun.file(join(dir, "A", "S", "A - S.mp3")).text()).toBe("existing");
  });

  test("place leaves a file that is already where it belongs untouched", async () => {
    const file = join(dir, "A", "S", "A - S.mp3");
    await mkdir(join(dir, "A", "S"), { recursive: true });
    await writeFile(file, "x");

    expect(await place(dir, file, { artist: "A", title: "S", album: "S" })).toBe(file);
  });

  test("place keeps a numbered song's own name when nothing about its place changes", async () => {
    await mkdir(join(dir, "A", "T"), { recursive: true });
    await writeFile(join(dir, "A", "T", "A - T.mp3"), "other song");
    const own = join(dir, "A", "T", "A - T (2).mp3");
    await writeFile(own, "this song");

    expect(await place(dir, own, { artist: "A", title: "T", album: "T" })).toBe(own);
  });

  test("remove deletes the file and prunes empty folders", async () => {
    const file = join(dir, "A", "S", "A - S.mp3");
    await mkdir(join(dir, "A", "S"), { recursive: true });
    await writeFile(file, "x");

    await remove(dir, file);

    expect(existsSync(join(dir, "A"))).toBe(false);
  });

  test("listMp3 finds mp3 files recursively and skips hidden folders", async () => {
    await mkdir(join(dir, "A", "S"), { recursive: true });
    await mkdir(join(dir, ".tmp"), { recursive: true });
    await writeFile(join(dir, "A", "S", "A - S.mp3"), "x");
    await writeFile(join(dir, "A", "S", "cover.jpg"), "x");
    await writeFile(join(dir, ".tmp", "partial.mp3"), "x");

    expect(await listMp3(dir)).toEqual([join(dir, "A", "S", "A - S.mp3")]);
  });
});
