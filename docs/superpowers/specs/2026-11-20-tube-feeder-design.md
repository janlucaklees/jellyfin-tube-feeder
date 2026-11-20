# jellyfin-tube-feeder — design

Supersedes `2026-11-20-natatube-design.md` (the CLI prototype). Its download, AI-tagging,
cover and fallback logic carry over as modules; the CLI itself goes.

## Intent

A small web app on StorageBaby where JLK or his wife paste YouTube links and get properly
tagged MP3s straight into the Jellyfin music library — and can fix the tags later from the
same page. The songs are mostly one-off uploads (often kids' music) that no music database
knows, so a local AI model derives the tags from the video info. The point is a library that
stays findable and sortable, without anyone touching Jellyfin's own metadata editor.

It is a machine, not a tool: links in, finished library out, error messages when it fails.

## Goals

- Paste one or many links (one per line). Each becomes a card: queued → fetching info →
  AI tagging → downloading → writing → done (or failed, with the error and a retry button).
  Progress updates live.
- A finished card shows cover, artist, title, album, year, the source video, and which tags
  were fallbacks (to check). All four tags are editable; saving rewrites the MP3's tags and
  renames/moves the file to match. A card can be deleted (removes the file).
- Each song card can ask the AI again with a free-text hint ("Artist is …"); the hint and the
  re-fetched video info produce new tags, written like an edit. (The prototype's `--hint`.)
- Songs land in `<library>/<Artist>/<Album>/<Artist> - <Title>.mp3`; album = song title unless
  the video names a real album. Jellyfin needs one album per folder and reads embedded tags.
- Lists songs newest-added first.
- Runs on StorageBaby, reachable at `tubefeeder.home.klees.io` (home network only).
- Merging one StorageBaby PR (the pointer) brings it up; no secrets are needed.

## Non-goals

- Login/auth (`*.home.klees.io` resolves to the LAN; StorageBaby can add `basic_auth` later).
- Managing music the app didn't create (only files carrying its marker tag are listed).
- Playlists as a unit, online metadata databases, genre.
- Persisting in-progress work across restarts.

## Anti-goals

- Empty, "Unknown", "N/A" or commentary-laden tags in the library.
- A database or any state that needs its own backup.
- One monolith: download, tagging, library and web are separate modules wired by a thin
  orchestrator.

## Constraints

- Bun + TypeScript; frontend SolidJS 2 (2.0.3, `@solidjs/web`); everything in Docker; local
  workflow via mise, like Renaissance.
- StorageBaby: rootless Podman + Quadlet pod from `deploy/storagebaby/` in this repo; a
  pointer in the StorageBaby repo. Images on ghcr.io, public repo → no registry login.
- Ollama runs as a second container in the same pod (for now), CPU only, model `gemma4:e2b`
  (best of the evaluated local models: 8/8 artists and titles right, ~4 s per song).
- State is the filesystem only.

## Approaches

Database vs. filesystem state:
- SQLite / JSON DB — rejected: JLK wants nothing to back up and restore-from-files.
- Sidecar JSON per song — rejected (JLK's pick after trade-off): doubles files in Jellyfin's
  folders, must move with the song, can disagree with the MP3.
- **Tags only (chosen)**: the MP3 is the record. Custom ID3 `TXXX` frames hold the source URL,
  video id, added-at timestamp and fallback fields. The song list is a scan of the library.
  In-progress jobs live in memory only and are lost on restart (accepted).

Web stack:
- Server-rendered HTML with partial updates — no build step, but JLK chose Solid.
- Full Renaissance split (SvelteKit + API + worker containers) — far beyond three screens.
- **Bun server + SolidJS 2 single page (chosen by JLK)**: one image; Bun serves the JSON API,
  a server-sent-events stream for live progress, and the built Solid bundle.

Ollama placement: in-pod container (chosen, "easiest way to get it running for now") over a
separate StorageBaby service.

## Architecture

```
web (Bun.serve: API + SSE + static UI)
  └─ pipeline (orchestrator, one job at a time, in-memory job list, emits events)
       ├─ youtube   — yt-dlp: fetch info, download audio + thumbnail
       ├─ tagger    — Ollama prompt + schema, code-side fallback rules → Tags + fallback list
       ├─ mp3       — ffmpeg: square cover, write ID3 (incl. TXXX), read tags (ffprobe)
       └─ library   — paths (Artist/Album/Artist - Title.mp3), sanitising, unique names,
                      scan, move on edit, delete, prune empty folders
ui (SolidJS 2, built by Vite into static files served by web)
```

Each module knows only its own concern: youtube knows nothing of files in the library,
library knows nothing of YouTube, tagger is pure input→tags plus one HTTP call. Config by env:
`LIBRARY_DIR` (default `/music`), `OLLAMA_URL` (default `http://127.0.0.1:11434`),
`MODEL` (default `gemma4:e2b`), `PORT` (default `3000`).

Song identity: the video id (TXXX `TUBEFEEDER_VIDEO_ID`). A link whose video id is already in
the library is not downloaded again; its job finishes as "already in library".

API:
- `GET /api/songs` — library scan, newest `added` first.
- `POST /api/jobs` `{links: string}` — split on whitespace, enqueue each valid YouTube link.
- `GET /api/events` — SSE: job snapshots and song changes.
- `PUT /api/songs/:videoId` `{artist,title,album,year}` — retag + move; cleared fallback flags.
- `POST /api/songs/:videoId/ask` `{hint}` — re-run the AI with a hint, retag + move.
- `DELETE /api/songs/:videoId`, `POST /api/jobs/:id/retry`, `DELETE /api/jobs/:id`.
- `GET /api/songs/:videoId/cover` — embedded cover as JPEG.
- `GET /health`.

## Testing

- Unit tests (`bun test`, run in Docker): tagger fallback rules, library path building /
  sanitising / uniqueness / moves, mp3 tag write→read round trip with ffmpeg (a generated
  silent MP3; no network).
- Benchmark (separate from unit tests, real network): a fixture list of YouTube links with
  expected artist/title; runs fetch + AI tagging for a given model, scores artist/title
  matches and timing, prints a table. `mise run bench [model]`. Used to compare models.

## Deployment

- `Dockerfile`: multi-stage — build the UI with Bun/Vite, runtime `oven/bun:1.3-debian` + ffmpeg
  + latest yt-dlp; runs as root inside (rootless: that is the service user).
- GitHub Actions: on push to `main` build and push `ghcr.io/janlucaklees/jellyfin-tube-feeder`
  (`latest` + sha); weekly scheduled rebuild so yt-dlp stays current; unit tests gate the push.
- `deploy/storagebaby/`: pod with `tubefeeder-app` and `tubefeeder-ollama`;
  bind `/pool/shared/media/Music/YouTube` → `/music` rw, group `media`, `owner: 0`;
  `ollama` volume (pool) for models; app pulls the model through Ollama's API on start if
  missing; `AutoUpdate=registry` on both; `backup: none` (songs live in the media tree; no
  app data). Files created world-readable so Jellyfin (reads via other bits) sees them.
- StorageBaby PR: `hosts/StorageBaby/services/tubefeeder/source.yml` → this repo, `ref: main`.

## Builder's calls (made)

- Rebuilt in place in this repo; published as GitHub `janlucaklees/jellyfin-tube-feeder` (public).
- Playlist links: only the linked video is taken (`--no-playlist`).
- `Music/YouTube` does not exist on StorageBaby yet; no unmarked files to adopt.
- Benchmark cases: the 8 videos evaluated during design, with their expected artist/title.

## Left to the builder

UI layout details, SSE message shapes, exact prompt wording (start from the prototype's).
