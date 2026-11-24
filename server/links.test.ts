import { expect, test } from "bun:test";
import { isSpotify, parseLinks } from "./links";

const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

test("normalises the common link shapes to one canonical watch link", () => {
  const text = [
    "https://www.youtube.com/watch?v=F98x5f0ITKg&list=PL123&t=42s",
    "https://youtu.be/NTNLniTF-J0?si=abc",
    "https://music.youtube.com/watch?v=Km3BzXz-GhI&feature=share",
    "https://www.youtube.com/shorts/YJHTZbIdOFs",
    "youtube.com/watch?v=rJWZhitXWzI",
  ].join("\n");

  expect(parseLinks(text)).toEqual([
    { videoId: "F98x5f0ITKg", url: watch("F98x5f0ITKg"), source: "youtube" },
    { videoId: "NTNLniTF-J0", url: watch("NTNLniTF-J0"), source: "youtube" },
    { videoId: "Km3BzXz-GhI", url: watch("Km3BzXz-GhI"), source: "youtube" },
    { videoId: "YJHTZbIdOFs", url: watch("YJHTZbIdOFs"), source: "youtube" },
    { videoId: "rJWZhitXWzI", url: watch("rJWZhitXWzI"), source: "youtube" },
  ]);
});

test("ignores text that is not a video link and collapses duplicates", () => {
  const text = `Hier die Lieder:
    https://www.youtube.com/watch?v=F98x5f0ITKg, und nochmal
    https://youtu.be/F98x5f0ITKg
    https://www.youtube.com/@IdaimLiederkasten
    https://example.com/watch?v=F98x5f0ITKg`;

  expect(parseLinks(text)).toEqual([{ videoId: "F98x5f0ITKg", url: watch("F98x5f0ITKg"), source: "youtube" }]);
});

const track = (id: string) => `https://open.spotify.com/track/${id}`;

test("accepts Spotify song links, localised and as URIs, in order with YouTube links", () => {
  const text = [
    "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=a1b2c3",
    "https://youtu.be/NTNLniTF-J0",
    "https://open.spotify.com/intl-de/track/0kosUz0jePvjiz4ctmR6wL",
    "spotify:track:3XmwAZpIMNpTJy8faw3ajD",
  ].join(" ");

  expect(parseLinks(text)).toEqual([
    { videoId: "4uLU6hMCjMI75M1A2tKUQC", url: track("4uLU6hMCjMI75M1A2tKUQC"), source: "spotify" },
    { videoId: "NTNLniTF-J0", url: watch("NTNLniTF-J0"), source: "youtube" },
    { videoId: "0kosUz0jePvjiz4ctmR6wL", url: track("0kosUz0jePvjiz4ctmR6wL"), source: "spotify" },
    { videoId: "3XmwAZpIMNpTJy8faw3ajD", url: track("3XmwAZpIMNpTJy8faw3ajD"), source: "spotify" },
  ]);
});

test("ignores Spotify albums, playlists and artists: single songs only", () => {
  const text = [
    "https://open.spotify.com/album/6N9PS4QXF1D0OWPk0Sxtb4",
    "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    "https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt",
  ].join(" ");
  expect(parseLinks(text)).toEqual([]);
});

test("tells Spotify songs from YouTube videos by their source link", () => {
  expect(isSpotify(track("4uLU6hMCjMI75M1A2tKUQC"))).toBe(true);
  expect(isSpotify(watch("NTNLniTF-J0"))).toBe(false);
});
