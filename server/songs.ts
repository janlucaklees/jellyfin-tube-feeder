/**
 * The songs the app made, indexed in memory by video id. Built from a scan of
 * the library at start; every change goes to the MP3 first, then the index.
 */
import * as library from "./library";
import * as mp3 from "./mp3";
import type { Song, TagName, Tags } from "./song";

export function createSongIndex(libraryDir: string) {
  const byId = new Map<string, Song>();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());

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
      changed();
      return song;
    },

    /** Called after every change, so open pages can refresh. */
    on(listener: () => void): () => void {
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
      changed();
      return updated;
    },

    async remove(videoId: string): Promise<boolean> {
      const song = byId.get(videoId);
      if (!song) return false;
      await library.remove(libraryDir, song.file);
      byId.delete(videoId);
      changed();
      return true;
    },
  };
}

export type SongIndex = ReturnType<typeof createSongIndex>;
