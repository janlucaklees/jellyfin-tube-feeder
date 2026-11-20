# jellyfin-tube-feeder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web app that turns pasted YouTube links into AI-tagged MP3s in the Jellyfin music tree, editable afterwards, deployable to StorageBaby.

**Architecture:** One Bun process: modules `youtube`, `tagger`, `mp3`, `library` wired by a `pipeline` orchestrator; `web` exposes JSON API + SSE + the built SolidJS 2 UI. State = MP3 tags in the library folder; jobs in memory. Ollama is a sibling container.

**Tech Stack:** Bun 1.3, TypeScript, SolidJS 2.0.3 (`solid-js`, `@solidjs/web`, `@solidjs/vite-plugin` 3, Vite 8), yt-dlp, ffmpeg, Ollama, Docker/mise, GitHub Actions → ghcr.io, StorageBaby Quadlet.

**Spec:** `docs/superpowers/specs/2026-11-20-tube-feeder-design.md`

## Global Constraints

- Everything runs in Docker via mise tasks; nothing installed on the host.
- Env: `LIBRARY_DIR` (default `/music`), `OLLAMA_URL` (default `http://127.0.0.1:11434`), `MODEL` (default `gemma4:e2b`), `PORT` (default `3000`).
- Layout `<LIBRARY_DIR>/<Artist>/<Album>/<Artist> - <Title>.mp3`; album = title when the video names none.
- Marker TXXX frames: `TUBEFEEDER_VIDEO_ID`, `TUBEFEEDER_SOURCE_URL`, `TUBEFEEDER_ADDED` (ISO timestamp), `TUBEFEEDER_FALLBACKS` (comma list of tag names). Only files with `TUBEFEEDER_VIDEO_ID` are listed.
- No placeholders ("Unknown", "N/A", empty) ever written as a tag.
- Unit tests touch no network; the benchmark is separate (`bench/`), never under `*.test.ts`.
- Check command: `mise run check` = type-check + `bun test`, in Docker.

## Review Focus

- Same link twice in one paste, or a link already in the library → one download; second job ends "already in library". (Task 5 test)
- Links with extra params (`&list=…&t=…`, `youtu.be/…`, `music.youtube.com`, `shorts/`) → normalised to the single video; non-link text in the paste is ignored. (Task 4 test)
- Artist/title containing `/`, `:`, `?`, trailing dots or only junk characters → safe, non-empty path segment. (Task 2 test)
- Edit that makes a song collide with an existing file → unique name, no overwrite; old empty folders removed. (Task 2 test)
- Ollama unreachable or model not pulled yet → song still written with fallback tags flagged, not a failed job. (Task 3 test)

---

### Task 1: Scaffold the app (replace the CLI)

**Files:**
- Delete: `src/`, `bin/`
- Create: `server/config.ts`, `package.json`, `tsconfig.json`, `ui/tsconfig.json`, `vite.config.ts`, `Dockerfile`, `compose.yml`, `mise.toml`, `.gitignore`, `.dockerignore`

**Interfaces:**
- Produces: `config: { libraryDir: string; ollamaUrl: string; model: string; port: number }` from `server/config.ts`.

- [ ] Step 1: package.json deps `solid-js@2.0.3`, `@solidjs/web@2.0.3`; dev `vite@^8`, `@solidjs/vite-plugin@^3`, `typescript`, `@types/bun`. Scripts: `build:ui` (vite build → `dist/ui`), `start` (`bun server/main.ts`).
- [ ] Step 2: Dockerfile multi-stage: `ui` stage builds the UI; runtime `oven/bun:1.3-debian` + ffmpeg + latest yt-dlp standalone, copies `server/`, `node_modules` (prod), `dist/ui`; `CMD ["bun","server/main.ts"]`; `HEALTHCHECK` via `curl /health`.
- [ ] Step 3: compose.yml: `app` (build ., dev mounts `./:/app`, `./music:/music`, port 3000, `OLLAMA_URL=http://ollama:11434`), `ollama` (`ollama/ollama`, volume `ollama`). mise tasks: `build`, `deps`, `up`, `down`, `dev` (vite dev + server), `test`, `check`, `bench`.
- [ ] Step 4: `mise run build && mise run deps && mise run check` → passes (no tests yet is OK).
- [ ] Step 5: Commit.

### Task 2: library module

**Files:** Create `server/library.ts`, Test `server/library.test.ts`

**Interfaces:**
- Produces: `segment(s: string): string`; `songPath(dir: string, t: {artist; title; album}): string` (relative); `uniquePath(abs: string): string`; `place(libraryDir, from: string, tags): Promise<string>` (moves/renames into layout, returns new abs path, prunes empty dirs left behind); `remove(libraryDir, file): Promise<void>` (deletes + prunes); `listMp3(libraryDir): Promise<string[]>`.

- [ ] Step 1: Tests: `segment("AC/DC")==="AC_DC"`, `segment("  ...  ")` non-empty (`"_"`), trailing dots/spaces stripped, length ≤ 120; `songPath` → `Ida/Hallo du!/Ida - Hallo du!.mp3`; `uniquePath` appends ` (2)`; `place` into tmp dir moves file and removes the now-empty old `Artist/Album` folders but never `libraryDir` itself; `place` onto an occupied target yields ` (2)`.
- [ ] Step 2: Run → fail. Step 3: implement (`node:fs/promises`). Step 4: Run → pass. Step 5: Commit.

### Task 3: mp3 + tagger modules (carry over prototype)

**Files:** Create `server/mp3.ts`, `server/tagger.ts`, Tests `server/mp3.test.ts`, `server/tagger.test.ts`

**Interfaces:**
- Produces: `type Tags = { artist: string; title: string; album: string; year?: number }`; `type Song = Tags & { file: string; videoId: string; sourceUrl: string; added: string; fallbacks: (keyof Tags)[] }`.
- `mp3.writeMp3(audio, cover: string | null, song: Omit<Song,"file">, target): Promise<void>` (cover cropped square; ID3v2.3; TXXX frames via `-metadata TUBEFEEDER_…=`); `mp3.retag(file, song): Promise<void>` (copy streams incl. cover, new tags, atomic replace); `mp3.readSong(file): Promise<Song | null>` (ffprobe JSON; null without `TUBEFEEDER_VIDEO_ID`); `mp3.readCover(file): Promise<Uint8Array | null>`.
- `tagger.resolveTags(info: VideoInfo, opts: { hint?: string; ask?: (info, hint?) => Promise<Partial<Tags>> }): Promise<{ tags: Tags; fallbacks: (keyof Tags)[] }>`; `tagger.askOllama(url, model)` returns the default `ask`.

- [ ] Step 1: Tests: mp3 round trip on an ffmpeg-generated 1 s silent MP3 + generated JPEG — `readSong` returns the written tags and TXXX values; `retag` changes artist and keeps the cover; untagged MP3 → `null`. Tagger: `ask` returning `{artist:"N/A", title:"", album:"Unknown", year: 3000}` → artist = info.artist ?? channel, title = info.track ?? info.title, album = title, year = release/upload year, fallbacks `["artist","title","album","year"]`; `ask` throwing → same fallbacks, no throw; AI album equal to channel name with no `info.album` → album = title (prototype bug, JLK's rule).
- [ ] Step 2: Run → fail. Step 3: implement (ported from prototype `src/metadata.ts`, `src/mp3.ts`). Step 4: Run → pass. Step 5: Commit.

### Task 4: youtube module

**Files:** Create `server/youtube.ts`, Test `server/youtube.test.ts`

**Interfaces:**
- Produces: `type VideoInfo` (prototype fields + `id`, `webpage_url`); `parseLinks(text: string): { videoId: string; url: string }[]` (deduped, canonical `https://www.youtube.com/watch?v=<id>`); `fetchInfo(url)`; `download(url, dir): Promise<{ audio: string; cover: string | null }>`.

- [ ] Step 1: Tests for `parseLinks`: watch?v= with `&list=&t=`, `youtu.be/ID?si=`, `music.youtube.com/watch?v=`, `youtube.com/shorts/ID`, junk words ignored, duplicates collapsed, order kept.
- [ ] Step 2–4: fail → implement (yt-dlp with `--js-runtimes bun --no-playlist`) → pass. Step 5: Commit.

### Task 5: pipeline orchestrator

**Files:** Create `server/pipeline.ts`, Test `server/pipeline.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: `type JobState = "queued"|"fetching"|"tagging"|"downloading"|"writing"|"done"|"duplicate"|"failed"`; `type Job = { id: string; url: string; videoId: string; state: JobState; title?: string; error?: string; songFile?: string }`; `createPipeline(deps: { libraryDir; fetchInfo; download; resolveTags; writeMp3; findByVideoId(id): Promise<Song|null> }) → { enqueue(text): Job[]; retry(id); dismiss(id); jobs(): Job[]; on(listener: (e: { type: "job"; job: Job } | { type: "song"; videoId: string } | { type: "song-removed"; videoId: string }) => void) }`. One job at a time; work dir under `os.tmpdir()`, always cleaned.

- [ ] Step 1: Tests with fake deps: two jobs run sequentially with state events in order; same video twice in one paste → one job; video already in library → `duplicate`; `download` throws → `failed` with message, next job still runs; `retry` re-queues a failed job.
- [ ] Step 2–4: fail → implement → pass. Step 5: Commit.

### Task 6: web server

**Files:** Create `server/songs.ts` (scan + in-memory index by videoId, `list()` newest `added` first, `update`, `remove`), `server/web.ts`, `server/main.ts`; Test `server/web.test.ts`

**Interfaces:** Routes per spec (`GET /api/songs`, `POST /api/jobs {links}`, `GET /api/events` SSE, `PUT/DELETE /api/songs/:videoId`, `GET /api/songs/:videoId/cover`, `POST /api/songs/:videoId/ask {hint}` (fetchInfo + resolveTags with hint → same path as PUT, fallbacks from the tagger), `POST /api/jobs/:id/retry`, `DELETE /api/jobs/:id`, `GET /health`, static `dist/ui` with SPA fallback). `PUT` validates non-empty artist/title/album (400 otherwise), retags, `place()`s, clears fallbacks. On start: ensure model present (`POST /api/pull` to Ollama, background, logged; no crash if Ollama is down).

- [ ] Step 1: Tests via `createApp(deps).fetch(Request)`: PUT with empty title → 400; PUT valid → song moved and listed under new artist; DELETE removes file; `/health` 200.
- [ ] Step 2–4: fail → implement → pass. Step 5: Commit.

### Task 7: SolidJS 2 UI

**Files:** Create `ui/index.html`, `ui/main.tsx`, `ui/api.ts`, `ui/App.tsx`, `ui/SongCard.tsx`, `ui/JobCard.tsx`, `ui/style.css`

- [ ] Step 1: Paste box (textarea + "Add"), job cards (state, title, error + Retry/Dismiss), song cards (cover, artist/title/album/year inputs with draft signals, fallback fields highlighted "check this", Save, Delete with confirm, "Ask AI again" with a hint input, link to video). Live via `EventSource('/api/events')`; songs refetched on `song` events. Follow Solid 2 rules (`createStore` draft setters, two-arg `createEffect`, `@solidjs/web` render).
- [ ] Step 2: `mise run build`; run stack; paste example link; verify card goes to done, edit artist → file moves (check `./music`). No unit tests (eyeballed).
- [ ] Step 3: Commit.

### Task 8: benchmark

**Files:** Create `bench/cases.json` (8 evaluated videos with expected artist/title), `bench/run.ts`

- [ ] Step 1: `bun bench/run.ts [model]`: per case fetch info + `resolveTags` with `askOllama`, case-insensitive compare artist/title, print table (case, got, ok?, seconds) + score and mean time. No download needed (tags only) — flag `--download` also runs download+write into a tmp dir to time the full path.
- [ ] Step 2: `mise run bench` against host-or-compose Ollama → prints 8 rows; gemma4:e2b ≥ 7/8.
- [ ] Step 3: Commit.

### Task 9: CI + StorageBaby contract + docs

**Files:** Create `.github/workflows/image.yml`, `deploy/storagebaby/{service.yml,README.md,quadlet/tubefeeder.pod.j2,quadlet/tubefeeder-app.container.j2,quadlet/tubefeeder-ollama.container.j2}`; rewrite `README.md`

- [ ] Step 1: Workflow: on push to main, weekly cron, manual → `bun install`, `bun test`, build+push `ghcr.io/janlucaklees/jellyfin-tube-feeder:{latest,sha}` (GITHUB_TOKEN, `packages: write`).
- [ ] Step 2: service.yml `name: tubefeeder`, `domain: tubefeeder`, `container_port: 3000`, `volumes: { ollama: { class: pool } }`, `binds: { music: { host: /pool/shared/media/Music/Children, container: /music, mode: rw, group: media, owner: 0 } }`, `secrets: []`, `backup: none`. Pod publishes `127.0.0.1:{{ publish_port }}:{{ container_port }}`. App container `After/Wants` ollama; both `AutoUpdate=registry`, `HealthCmd`, `HealthOnFailure=kill`, `Restart=always`, `TZ`. Ollama image pinned version (`ollama/ollama:<current>`), health via `ollama list`.
- [ ] Step 3: Render check with the Jinja script from the StorageBaby skill reference (in Docker).
- [ ] Step 4: Commit.

### Task 10: Publish

- [ ] Step 1: `gh repo create janlucaklees/jellyfin-tube-feeder --public`, push `master`→`main`; wait for the workflow to publish the image (`gh run watch`).
- [ ] Step 2: StorageBaby: worktree from `origin/master`, branch `tubefeeder`, add `hosts/StorageBaby/services/tubefeeder/source.yml` (`repo`, `ref: main`, `path: deploy/storagebaby`), run `mise run test-static` if available, commit, push, `gh pr create`.
- [ ] Step 3: Move spec+plan to archive per charter only at merge time — not here (repo has no feature branch; leave live).
