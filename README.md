# natatube

One YouTube link in, one tagged `Artist - Title.mp3` out — in the directory you run it from.
A local AI model (host Ollama) works out artist, title, album and year from the video info;
the thumbnail, cropped square, becomes the cover.

## Setup

```sh
mise trust && mise run build && mise run deps
ln -s "$PWD/bin/natatube" ~/.local/bin/natatube   # optional: use it from anywhere
ollama pull gemma4:e2b                            # if not installed yet
```

## Usage

```sh
natatube "https://www.youtube.com/watch?v=F98x5f0ITKg"
natatube "<link>" --hint "Artist is Ida im Liederkasten, album Herbstlieder"
```

The report marks tags that fell back to raw video data with `(fallback — check this)`.
`--hint` is free text the AI treats as authoritative. Existing files are never overwritten.

## Tasks

| Task | What |
|---|---|
| `mise run build` | Build the image; also updates yt-dlp to the latest release (do this when YouTube downloads break) |
| `mise run deps` | Install TypeScript dev dependencies |
| `mise run check` | Type-check |
| `mise run get <link>` | Same as `bin/natatube`, but writes into the repo root |

## Configuration

- `NATATUBE_MODEL` — Ollama model, default `gemma4:e2b` (best of the installed models on real
  kids'-song uploads: all artists/titles right, ~4 s per song). Worth trying if quality falls short:
  `gemma4:e4b`, `qwen3:4b`.
- `OLLAMA_URL` — default `http://127.0.0.1:11434`. The container uses host networking because
  Ollama listens on loopback only.
