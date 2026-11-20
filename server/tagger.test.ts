import { describe, expect, test } from "bun:test";
import { resolveTags } from "./tagger";
import type { VideoInfo } from "./youtube";

const messy: VideoInfo = {
  id: "abc",
  title: "Das ist gerade, das ist schief - Kinderlieder zum Mitsingen | Sing Kinderlieder",
  channel: "Sing mit mir - Kinderlieder",
  upload_date: "20160301",
};

const musicUpload: VideoInfo = {
  id: "F98x5f0ITKg",
  title: "Hallo du!",
  channel: "Ida im Liederkasten",
  artist: "Ida im Liederkasten",
  track: "Hallo du!",
  album: "Hallo du!",
  release_year: 2024,
  upload_date: "20241022",
};

describe("resolveTags", () => {
  test("takes the AI's answer when it is usable", async () => {
    const result = await resolveTags(messy, {
      ask: async () => ({ artist: "Sing mit mir", title: "Das ist gerade, das ist schief", album: "", year: 2016 }),
    });
    expect(result.tags).toEqual({
      artist: "Sing mit mir",
      title: "Das ist gerade, das ist schief",
      album: "Das ist gerade, das ist schief",
      year: 2016,
    });
    expect(result.fallbacks).toEqual([]);
  });

  test("replaces placeholders and impossible years with video data and flags them", async () => {
    const result = await resolveTags(musicUpload, {
      ask: async () => ({ artist: "N/A", title: "", album: "Unknown", year: 3000 }),
    });
    expect(result.tags).toEqual({ artist: "Ida im Liederkasten", title: "Hallo du!", album: "Hallo du!", year: 2024 });
    expect(result.fallbacks).toEqual(["artist", "title", "year"]);
  });

  test("falls back to channel and raw title when YouTube has no music data", async () => {
    const result = await resolveTags(messy, { ask: async () => ({}) });
    expect(result.tags.artist).toBe("Sing mit mir - Kinderlieder");
    expect(result.tags.title).toBe(messy.title);
    expect(result.tags.year).toBe(2016);
    expect(result.fallbacks).toEqual(["artist", "title", "year"]);
  });

  test("survives the AI failing entirely", async () => {
    const result = await resolveTags(musicUpload, {
      ask: async () => {
        throw new Error("connection refused");
      },
    });
    expect(result.tags.artist).toBe("Ida im Liederkasten");
    expect(result.fallbacks).toContain("artist");
  });

  test("album is the song title unless the video names a real album", async () => {
    const result = await resolveTags(messy, {
      ask: async () => ({ artist: "Sing mit mir", title: "Schief", album: "Sing Kinderlieder", year: 2016 }),
    });
    expect(result.tags.album).toBe("Schief");
  });

  test("keeps a real album the video names", async () => {
    const withAlbum = { ...musicUpload, album: "Herbstlieder", track: "Blättertanz" };
    const result = await resolveTags(withAlbum, {
      ask: async () => ({ artist: "Ida im Liederkasten", title: "Blättertanz", album: "Herbstlieder", year: 2024 }),
    });
    expect(result.tags.album).toBe("Herbstlieder");
  });

  test("a hint's album wins even without a video album", async () => {
    const result = await resolveTags(messy, {
      hint: "Album ist Bewegungslieder",
      ask: async () => ({ artist: "Sing mit mir", title: "Schief", album: "Bewegungslieder", year: 2016 }),
    });
    expect(result.tags.album).toBe("Bewegungslieder");
  });

  test("passes the hint on to the AI", async () => {
    let seen: string | undefined;
    await resolveTags(messy, {
      hint: "Artist is Sing mit mir",
      ask: async (_info, hint) => {
        seen = hint;
        return {};
      },
    });
    expect(seen).toBe("Artist is Sing mit mir");
  });
});
