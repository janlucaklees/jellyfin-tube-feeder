import { expect, test } from "bun:test";
import { parseLinks } from "./links";

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
    { videoId: "F98x5f0ITKg", url: watch("F98x5f0ITKg") },
    { videoId: "NTNLniTF-J0", url: watch("NTNLniTF-J0") },
    { videoId: "Km3BzXz-GhI", url: watch("Km3BzXz-GhI") },
    { videoId: "YJHTZbIdOFs", url: watch("YJHTZbIdOFs") },
    { videoId: "rJWZhitXWzI", url: watch("rJWZhitXWzI") },
  ]);
});

test("ignores text that is not a video link and collapses duplicates", () => {
  const text = `Hier die Lieder:
    https://www.youtube.com/watch?v=F98x5f0ITKg, und nochmal
    https://youtu.be/F98x5f0ITKg
    https://www.youtube.com/@IdaimLiederkasten
    https://example.com/watch?v=F98x5f0ITKg`;

  expect(parseLinks(text)).toEqual([{ videoId: "F98x5f0ITKg", url: watch("F98x5f0ITKg") }]);
});
