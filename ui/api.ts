/** The server's API, typed for the page. */
export type TagName = "artist" | "title" | "album" | "year";

export interface Song {
  file: string;
  videoId: string;
  sourceUrl: string;
  added: string;
  artist: string;
  title: string;
  album: string;
  year?: number;
  fallbacks: TagName[];
}

export type JobState = "queued" | "fetching" | "tagging" | "downloading" | "writing" | "done" | "duplicate" | "failed";

export interface Job {
  id: string;
  url: string;
  videoId: string;
  state: JobState;
  title?: string;
  error?: string;
}

export type ServerEvent =
  | { type: "jobs"; jobs: Job[] }
  | { type: "job"; job: Job }
  | { type: "job-removed"; id: string }
  | { type: "songs" };

export interface TagsInput {
  artist: string;
  title: string;
  album: string;
  year: number | null;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(error.error ?? `${response.status} ${response.statusText}`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  songs: () => call<Song[]>("GET", "/api/songs"),
  addLinks: (links: string) => call<Job[]>("POST", "/api/jobs", { links }),
  retry: (id: string) => call<void>("POST", `/api/jobs/${id}/retry`),
  dismiss: (id: string) => call<void>("DELETE", `/api/jobs/${id}`),
  save: (videoId: string, tags: TagsInput) => call<Song>("PUT", `/api/songs/${videoId}`, tags),
  ask: (videoId: string, hint: string) => call<Song>("POST", `/api/songs/${videoId}/ask`, { hint }),
  remove: (videoId: string) => call<void>("DELETE", `/api/songs/${videoId}`),
  coverUrl: (song: Song) => `/api/songs/${song.videoId}/cover?v=${encodeURIComponent(song.file)}`,
  events: (onEvent: (event: ServerEvent) => void): (() => void) => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => onEvent(JSON.parse(message.data) as ServerEvent);
    return () => source.close();
  },
};
