import { afterEach, expect, test } from "bun:test";
import { createJellyfin, type FileChange } from "./jellyfin";

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => server?.stop(true));

function fakeJellyfin() {
  const received: { path: string; token: string | null; body: unknown }[] = [];
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({ path: new URL(request.url).pathname, token: request.headers.get("X-Emby-Token"), body: await request.json() });
      return new Response(null, { status: 204 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, received };
}

const changes: FileChange[] = [
  { file: "/music/Ida/Hallo du!/Ida - Hallo du!.mp3", type: "Deleted" },
  { file: "/music/Ida im Liederkasten/Hallo du!/Ida im Liederkasten - Hallo du!.mp3", type: "Created" },
];

test("reports changed files under the path Jellyfin sees the library at", async () => {
  const jellyfin = fakeJellyfin();
  await createJellyfin({ url: jellyfin.url, apiKey: "key", libraryDir: "/music", libraryPath: "/media/Music/Children" }).report(changes);

  expect(jellyfin.received).toEqual([
    {
      path: "/Library/Media/Updated",
      token: "key",
      body: {
        Updates: [
          { Path: "/media/Music/Children/Ida/Hallo du!/Ida - Hallo du!.mp3", UpdateType: "Deleted" },
          { Path: "/media/Music/Children/Ida im Liederkasten/Hallo du!/Ida im Liederkasten - Hallo du!.mp3", UpdateType: "Created" },
        ],
      },
    },
  ]);
});

test("does nothing without an API key", async () => {
  const jellyfin = fakeJellyfin();
  await createJellyfin({ url: jellyfin.url, apiKey: "", libraryDir: "/music", libraryPath: "/media/Music/Children" }).report(changes);
  expect(jellyfin.received).toEqual([]);
});

test("an unreachable Jellyfin is logged, never thrown", async () => {
  const jellyfin = createJellyfin({ url: "http://127.0.0.1:9", apiKey: "key", libraryDir: "/music", libraryPath: "/media/Music/Children" });
  await expect(jellyfin.report(changes)).resolves.toBeUndefined();
});
