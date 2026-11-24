import { expect, test } from "bun:test";
import { readPage } from "./spotify";

// Trimmed from the real page of https://open.spotify.com/track/0kosUz0jePvjiz4ctmR6wL (2026-11).
const page = `<!DOCTYPE html><html><head><title>Dai Dai - song and lyrics by Shakira, Burna Boy | Spotify</title>
<meta property="og:site_name" content="Spotify"/>
<meta property="og:title" content="Dai Dai"/>
<meta property="og:description" content="Shakira, Burna Boy · Dai Dai · Song · 2026"/>
<meta property="og:image" content="https://i.scdn.co/image/ab67616d0000b273aaaa"/>
<meta name="music:duration" content="223"/>
<meta name="music:album" content="https://open.spotify.com/album/2eeufspLkAubwTJfOGSrI8"/>
<meta name="music:release_date" content="2026-05-14"/>
<meta name="music:musician" content="https://open.spotify.com/artist/0EmeFodog0BfCgMzAIvKQp"/>
<meta name="music:musician_description" content="Shakira, Burna Boy"/>
</head><body><div id="main">Dai Dai</div></body></html>`;

const noAi = async () => {
  throw new Error("the AI must not be asked");
};

test("reads every detail from the page's link-preview tags, without the AI", async () => {
  expect(await readPage(page, noAi)).toEqual({
    title: "Dai Dai",
    artist: "Shakira, Burna Boy",
    album: "Dai Dai",
    year: 2026,
    durationSec: 223,
    coverUrl: "https://i.scdn.co/image/ab67616d0000b273aaaa",
  });
});

test("takes the album from between the artists and the last two parts, entities decoded", async () => {
  const album = page
    .replace("Shakira, Burna Boy · Dai Dai · Song", "Shakira, Burna Boy · Las Mujeres Ya No Lloran &amp; More · Song")
    .replace('content="Dai Dai"', 'content="Don&#39;t Wait"');
  expect(await readPage(album, noAi)).toMatchObject({ title: "Don't Wait", album: "Las Mujeres Ya No Lloran & More" });
});

test("when the tags are gone, the AI reads the page's text and fills only the gaps", async () => {
  const changed = page.replace(/<meta property="og:description"[^>]*>/, "").replace(/<meta name="music:duration"[^>]*>/, "");
  let seen = "";
  const details = await readPage(changed, async (_system, text) => {
    seen = text;
    return { title: "AI title", artist: "AI artist", album: "Dai Dai", year: 2026, duration_seconds: 223 };
  });
  expect(seen).toContain("Dai Dai - song and lyrics by Shakira, Burna Boy");
  expect(details).toMatchObject({ title: "Dai Dai", artist: "Shakira, Burna Boy", album: "Dai Dai", durationSec: 223 });
});

test("fails when neither the tags nor the AI give what matching needs", async () => {
  const bare = "<html><head><title>Spotify</title></head><body></body></html>";
  const empty = async () => ({ title: "", artist: "", album: "", year: 0, duration_seconds: 0 });
  await expect(readPage(bare, empty)).rejects.toThrow(/fehlt: title, artist, album, durationSec/);
});
