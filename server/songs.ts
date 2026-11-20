/**
 * The songs the app made, indexed in memory by video id. Built from a scan of
 * the library at start; every change goes to the MP3 first, then the index.
 */
import type { FileChange } from "./jellyfin";
import * as library from "./library";
import * as mp3 from "./mp3";
import type { Song, TagName, Tags } from "./song";

export function createSongIndex(libraryDir: string) {
  const byId = new Map<string, Song>();
  const listeners = new Set<(changes: FileChange[]) => void>();
  const changed = (changes: FileChange[]) => listeners.forEach((listener) => listener(changes));

  return {
    async load(): Promise<void> {
      byId.clear();
      for (const file of await library.listMp3(libraryDir)) {
        const song = await mp3.readSong(file).catch(() => null);
        if (song) byId.set(song.videoId, song);
      }
    },

    /** Reads a freshly written MP3 into the index. */
    async add(file: string): Promise<Song | null> {
      const song = await mp3.readSong(file);
      if (song) byId.set(song.videoId, song);
      changed([{ file, type: "Created" }]);
      return song;
    },

    /** Called after every change with the files it touched, so pages and Jellyfin can catch up. */
    on(listener: (changes: FileChange[]) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Newest added first. */
    list: (): Song[] => [...byId.values()].sort((a, b) => b.added.localeCompare(a.added)),
    get: (videoId: string): Song | undefined => byId.get(videoId),
    has: (videoId: string): boolean => byId.has(videoId),

    /** Rewrites the song's tags and moves it to where they say it belongs. */
    async update(videoId: string, tags: Tags, fallbacks: TagName[] = []): Promise<Song | undefined> {
      const song = byId.get(videoId);
      if (!song) return undefined;
      const { file: _file, ...record } = song;
      const next = { ...record, artist: tags.artist, title: tags.title, album: tags.album, year: tags.year, fallbacks };
      await mp3.retag(song.file, next);
      const file = await library.place(libraryDir, song.file, next);
      const updated: Song = { ...next, file };
      if (updated.year === undefined) delete updated.year;
      byId.set(videoId, updated);
      changed(
        file === song.file
          ? [{ file, type: "Modified" }]
          : [
              { file: song.file, type: "Deleted" },
              { file, type: "Created" },
            ],
      );
      return updated;
    },

    async remove(videoId: string): Promise<boolean> {
      const song = byId.get(videoId);
      if (!song) return false;
      await library.remove(libraryDir, song.file);
      byId.delete(videoId);
      changed([{ file: song.file, type: "Deleted" }]);
      return true;
    },
  };
}

export type SongIndex = ReturnType<typeof createSongIndex>;
