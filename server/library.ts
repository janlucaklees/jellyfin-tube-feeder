/**
 * The music library on disk: where a song belongs, moving it there, removing it.
 * Knows nothing about YouTube or tags beyond the three that make up a path.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface PathTags {
  artist: string;
  title: string;
  album: string;
}

const MAX_SEGMENT = 120;

/** One path segment, safe on any filesystem Jellyfin might sit on. */
export function segment(value: string): string {
  const safe = value
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    // Leading dots would hide the folder (from this app's scan and from Jellyfin),
    // trailing ones break on Windows shares.
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, MAX_SEGMENT)
    .replace(/[. ]+$/, "");
  return safe === "" ? "_" : safe;
}

/** `Artist/Album/Artist - Title.mp3`, relative to the library. */
export function songPath(tags: PathTags): string {
  const artist = segment(tags.artist);
  return join(artist, segment(tags.album), `${segment(`${tags.artist} - ${tags.title}`)}.mp3`);
}

/**
 * `file`, or `file (2)`, `file (3)`… whichever does not exist yet. `own` is the file
 * being moved: its current name counts as free, so it keeps its number.
 */
export function uniquePath(file: string, own?: string): string {
  const base = file.replace(/\.mp3$/, "");
  const taken = (path: string) => existsSync(path) && (!own || resolve(path) !== resolve(own));
  let candidate = file;
  for (let n = 2; taken(candidate); n++) candidate = `${base} (${n}).mp3`;
  return candidate;
}

async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    // A freshly downloaded file sits on another filesystem (tmp), where rename cannot reach.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(from, to);
    await unlink(from);
  }
}

/** Removes empty folders from `dir` upwards, stopping at the library root. */
async function prune(libraryDir: string, dir: string): Promise<void> {
  const root = resolve(libraryDir);
  let current = resolve(dir);
  while (current !== root && current.startsWith(root + sep)) {
    if ((await readdir(current)).length > 0) return;
    await rmdir(current);
    current = dirname(current);
  }
}

/** Moves `file` to where `tags` say it belongs and returns its new path. */
export async function place(libraryDir: string, file: string, tags: PathTags): Promise<string> {
  const target = uniquePath(join(libraryDir, songPath(tags)), file);
  if (resolve(file) === resolve(target)) return file;
  await mkdir(dirname(target), { recursive: true });
  await move(file, target);
  if (!relative(libraryDir, file).startsWith("..")) await prune(libraryDir, dirname(file));
  return target;
}

export async function remove(libraryDir: string, file: string): Promise<void> {
  await unlink(file);
  await prune(libraryDir, dirname(file));
}

/** Every `.mp3` below the library, skipping hidden folders. */
export async function listMp3(libraryDir: string): Promise<string[]> {
  const entries = await readdir(libraryDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".mp3"))
    .map((e) => join(e.parentPath, e.name))
    .filter((file) => !relative(libraryDir, file).split(sep).some((part) => part.startsWith(".")))
    .sort();
}
