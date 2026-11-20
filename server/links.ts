/**
 * Which YouTube videos a pasted text names. Pure, so the page uses it too: it starts
 * processing as soon as the input holds a link the server will accept.
 */
export interface VideoLink {
  videoId: string;
  url: string;
}

const LINK =
  /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:[^\s]*?&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/g;

/** Every distinct video linked in `text`, in order, as canonical watch links. */
export function parseLinks(text: string): VideoLink[] {
  const seen = new Set<string>();
  const links: VideoLink[] = [];
  for (const match of text.matchAll(LINK)) {
    const videoId = match[1]!;
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    links.push({ videoId, url: `https://www.youtube.com/watch?v=${videoId}` });
  }
  return links;
}
