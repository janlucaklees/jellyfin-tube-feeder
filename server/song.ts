/** The tags a song carries, and the full record the app keeps inside each MP3. */
export interface Tags {
  artist: string;
  title: string;
  album: string;
  year?: number;
}

export type TagName = keyof Tags;

export interface Song extends Tags {
  /** Absolute path of the MP3. */
  file: string;
  videoId: string;
  sourceUrl: string;
  /** ISO timestamp of when the song was added; the list is sorted by it. */
  added: string;
  /** Tags the AI could not work out and that were filled from raw video data. */
  fallbacks: TagName[];
}
