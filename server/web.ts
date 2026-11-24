/**
 * HTTP: the JSON API, a server-sent-events stream for live updates, and the
 * built UI. Holds no logic of its own beyond validating input.
 */
import { join, normalize } from "node:path";
import { isSpotify } from "./links";
import { readCover } from "./mp3";
import type { Pipeline, PipelineEvent } from "./pipeline";
import type { Song, Tags } from "./song";
import type { SongIndex } from "./songs";

export interface AppDeps {
  songs: SongIndex;
  pipeline: Pipeline;
  /** Asks the AI again with a hint and writes the result; resolves to the updated song. */
  askAgain(videoId: string, hint: string): Promise<Song>;
  uiDir: string;
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
const bad = (message: string) => json({ error: message }, 400);
const notFound = () => json({ error: "not found" }, 404);

function parseTags(body: unknown): Tags | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof b[key] === "string" ? (b[key] as string).trim() : "");
  const [artist, title, album] = [text("artist"), text("title"), text("album")];
  if (!artist || !title || !album) return "artist, title and album must not be empty";
  if (b.year === undefined || b.year === null || b.year === "") return { artist, title, album };
  const year = Number(b.year);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return "year must be a four-digit number";
  return { artist, title, album, year };
}

export function createApp(deps: AppDeps) {
  const { songs, pipeline } = deps;

  function events(): Response {
    let unsubscribe = () => {};
    let ping: Timer | undefined;
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: PipelineEvent | { type: "jobs"; jobs: unknown } | { type: "songs" }) =>
          controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
        send({ type: "jobs", jobs: pipeline.jobs() });
        const offJobs = pipeline.on(send);
        const offSongs = songs.on(() => send({ type: "songs" }));
        unsubscribe = () => {
          offJobs();
          offSongs();
        };
        ping = setInterval(() => controller.enqueue(": ping\n\n"), 25_000);
      },
      cancel() {
        unsubscribe();
        clearInterval(ping);
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  }

  async function staticFile(pathname: string): Promise<Response> {
    const path = normalize(join(deps.uiDir, pathname));
    const file = Bun.file(path.startsWith(deps.uiDir) ? path : "");
    if (pathname !== "/" && (await file.exists())) return new Response(file);
    const index = Bun.file(join(deps.uiDir, "index.html"));
    return (await index.exists()) ? new Response(index) : notFound();
  }

  async function fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const method = request.method;
    const songMatch = pathname.match(/^\/api\/songs\/([A-Za-z0-9_-]{11}|[A-Za-z0-9]{22})(\/cover|\/ask)?$/);
    const jobMatch = pathname.match(/^\/api\/jobs\/([0-9a-f-]+)(\/retry)?$/);

    try {
      if (pathname === "/health") return new Response("ok");
      if (pathname === "/api/songs" && method === "GET") return json(songs.list());
      if (pathname === "/api/events" && method === "GET") return events();
      if (pathname === "/api/jobs" && method === "GET") return json(pipeline.jobs());
      if (pathname === "/api/jobs" && method === "POST") {
        const body = (await request.json().catch(() => ({}))) as { links?: unknown };
        if (typeof body.links !== "string") return bad("links must be text");
        return json(pipeline.enqueue(body.links), 202);
      }

      if (jobMatch) {
        const [, id, retry] = jobMatch;
        if (retry && method === "POST") pipeline.retry(id!);
        else if (!retry && method === "DELETE") pipeline.dismiss(id!);
        else return notFound();
        return new Response(null, { status: 204 });
      }

      if (songMatch) {
        const [, videoId, sub] = songMatch;
        if (!songs.has(videoId!)) return notFound();
        if (sub === "/cover" && method === "GET") {
          const cover = await readCover(songs.get(videoId!)!.file);
          return cover ? new Response(new Blob([cover as Uint8Array<ArrayBuffer>]), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-cache" } }) : notFound();
        }
        if (sub === "/ask" && method === "POST") {
          const body = (await request.json().catch(() => ({}))) as { hint?: unknown };
          const hint = typeof body.hint === "string" ? body.hint.trim() : "";
          if (!hint) return bad("hint must not be empty");
          if (isSpotify(songs.get(videoId!)!.sourceUrl)) return bad("Spotify songs are tagged from Spotify, not by the AI");
          return json(await deps.askAgain(videoId!, hint));
        }
        if (!sub && method === "PUT") {
          const tags = parseTags(await request.json().catch(() => null));
          if (typeof tags === "string") return bad(tags);
          return json(await songs.update(videoId!, tags));
        }
        if (!sub && method === "DELETE") {
          await songs.remove(videoId!);
          return new Response(null, { status: 204 });
        }
        return notFound();
      }

      if (pathname.startsWith("/api/")) return notFound();
      return staticFile(pathname);
    } catch (error) {
      console.error(`${method} ${pathname} failed:`, error);
      return json({ error: (error as Error).message }, 500);
    }
  }

  return { fetch };
}
