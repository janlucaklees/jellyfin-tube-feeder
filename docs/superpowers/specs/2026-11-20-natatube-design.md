# natatube — design (short)

## Intent
One YouTube link in, one properly named and tagged MP3 out, so songs land in the family music
library findable and sortable. Songs are mostly small/indie (often kids' music) that no music
database knows — so no online lookups.

## Goals / non-goals / anti-goals
- Goal: `natatube <link>` writes `Artist - Title.mp3` into the current directory, with artist,
  title, album, album artist, year and the thumbnail as cover. Prints what it found.
- Goal: a manual mode — `--hint "..."` — free text the AI uses together with the video info.
- Non-goal: playlists, batch mode, UI, online metadata lookup, confirmation prompts.
- Anti-goal: empty, "Unknown", "N/A" or commentary-laden tags. Every file must sort sensibly.

## Constraints
- Bun + TypeScript. Everything runs in Docker (mise tasks wrap `docker compose`), like Renaissance.
- AI is the host's Ollama (loopback-only, so the container uses host networking).

## Approaches
- Host Ollama vs. Ollama in a container → **host Ollama** (JLK's pick): already installed,
  GPU/CPU set up, no duplicate model download.
- Model: evaluated installed models on 8 real videos with schema-constrained output.
  `gemma4:e2b` got all artists/titles right at ~4 s; `qwen2.5:1.5b` mangled two, `qwen3:0.6b`
  returned junk, `llama3` was 7–27 s. Default `gemma4:e2b`, overridable via `NATATUBE_MODEL`.

## Design
1. `yt-dlp --dump-json` → video info (title, channel, description, YouTube's own artist/track/album).
2. Ollama `/api/chat` with a JSON schema (`artist, title, album, year`) and cleanup rules.
3. Code-side guard: placeholders/empties are rejected and fall back deterministically —
   artist → YouTube artist → channel; title → YouTube track → video title; album → YouTube album
   → title; year → model (sane range) → release year → upload year. Fallbacks are reported, with a
   suggestion to rerun with `--hint`.
4. `yt-dlp` downloads best audio as MP3 + thumbnail; `ffmpeg` crops the thumbnail to a centred
   square and writes ID3v2.3 tags + front cover.
5. Filename sanitised; never overwrites (appends ` (2)` etc.).

## Calls left to the builder (made)
- Launcher script `bin/natatube` (put on PATH) mounts the caller's cwd and runs as host UID/GID,
  because mise tasks only resolve inside the repo.
- yt-dlp installed as the latest standalone release at image build (YouTube breaks old versions);
  Bun serves as its JS runtime.
- Genre dropped: free-text genre from small models was garbage.
