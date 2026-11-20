# jellyfin-tube-feeder

Paste YouTube links into a web page; get properly tagged MP3s in the Jellyfin music
library. A local AI model (Ollama) works out artist, title, album and year from the video
info, the thumbnail cropped square becomes the cover. Every song stays editable from the
same page: change a tag and the file is retagged and moved to match.

Made for one-off uploads (kids' songs, small artists) that no music database knows.

## How it works

```
server/
  main.ts       wires everything, starts the server, makes Ollama pull the model
  web.ts        JSON API, server-sent events, the built UI
  pipeline.ts   one job at a time: fetch info → AI tags → download → write MP3 → place
  youtube.ts    yt-dlp: links in pasted text, video info, audio + thumbnail
  tagger.ts     Ollama prompt + the code-side rules that keep junk out of the tags
  mp3.ts        ffmpeg/ffprobe: write and read tags, cover, the app's own TXXX fields
  library.ts    Artist/Album/Artist - Title.mp3, safe names, moves, pruning
  songs.ts      in-memory index of the library, built by scanning it at start
ui/             SolidJS 2 page
bench/          model benchmark on real videos
deploy/storagebaby/   the StorageBaby service contract
```

**There is no database.** Each MP3 is its own record: besides the usual tags it carries
`TUBEFEEDER_VIDEO_ID`, `TUBEFEEDER_SOURCE_URL`, `TUBEFEEDER_ADDED` and
`TUBEFEEDER_FALLBACKS` as ID3 TXXX frames. The song list is a scan of the library folder,
so copying the folder restores everything. Jobs in progress live in memory and are gone
after a restart. Only MP3s carrying `TUBEFEEDER_VIDEO_ID` are listed or touched.

**Tag rules** (`server/tagger.ts`): the AI proposes; empty or placeholder answers
("Unknown", "N/A") fall back to YouTube's own music fields, then the channel name and raw
video title, and are flagged on the card for checking. The album is the song title unless
the video names a real album or a hint says otherwise. A video already in the library is
not downloaded again.

## Local development

Everything runs in Docker through [mise](https://mise.jdx.dev):

```sh
mise trust
mise run build      # images (also refreshes yt-dlp)
mise run deps       # node_modules, installed inside the container
mise run up         # app on http://localhost:3000, songs land in ./music
mise run dev        # plus the UI dev server with hot reload on http://localhost:5173
mise run check      # type-check + unit tests
mise run logs
mise run down
```

The first start makes the Ollama container download the model (~7 GB) into a volume.

## Benchmark: is a model good enough?

```sh
mise run bench                     # the default model
mise run bench qwen3:4b            # any other Ollama model (pulled if missing)
mise run bench gemma4:e2b --download   # also time download + MP3 writing
```

Runs the videos in `bench/cases.json` through the real fetch + AI tagging and checks
artist and title against the expected answers. Add cases there whenever a song comes out
wrong. `gemma4:e2b` (default): 8/8, about 4 s per song on a laptop CPU.

## Configuration

| Env | Default | |
| --- | --- | --- |
| `LIBRARY_DIR` | `/music` | where songs are written |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | |
| `MODEL` | `gemma4:e2b` | any Ollama model with structured output |
| `PORT` | `3000` | |

## Deployment

`deploy/storagebaby/` is the StorageBaby contract: a pod with the app and Ollama at
`tubefeeder.home.klees.io`, writing to `/pool/shared/media/Music/Children`. CI
(`.github/workflows/image.yml`) tests and publishes `ghcr.io/janlucaklees/jellyfin-tube-feeder`
on every push to `main` and weekly; StorageBaby's Podman auto-update picks it up.
