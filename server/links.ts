/**
 * Which songs a pasted text names: YouTube videos and Spotify tracks. Pure, so the page
 * uses it too: it starts processing as soon as the input holds a link the server will accept.
 */
export type Source = "youtube" | "spotify";

export interface SongLink {
  /** The YouTube video id or the Spotify track id: the song's identity in the library. */
  videoId: string;
  url: string;
  source: Source;
}

const YOUTUBE =
  /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:[^\s]*?&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const SPOTIFY = /(?:(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[A-Za-z-]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/;
const LINK = new RegExp(`${YOUTUBE.source}|${SPOTIFY.source}`, "g");

/** Every distinct song linked in `text`, in order, as canonical links. */
export function parseLinks(text: string): SongLink[] {
  const seen = new Set<string>();
  const links: SongLink[] = [];
  for (const match of text.matchAll(LINK)) {
    const [, youtubeId, spotifyId] = match;
    const videoId = (youtubeId ?? spotifyId)!;
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    links.push(
      youtubeId
        ? { videoId, url: `https://www.youtube.com/watch?v=${videoId}`, source: "youtube" }
        : { videoId, url: `https://open.spotify.com/track/${videoId}`, source: "spotify" },
    );
  }
  return links;
}

/** Whether a song's source link is a Spotify track. */
export const isSpotify = (url: string): boolean => SPOTIFY.test(url);
