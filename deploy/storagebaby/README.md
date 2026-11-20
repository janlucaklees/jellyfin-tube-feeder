# tubefeeder on StorageBaby

What runs: one pod, `tubefeeder`, at `tubefeeder.<host domain>` (home network only).

| Container | Image | Listens |
| --- | --- | --- |
| `tubefeeder-app` | `ghcr.io/janlucaklees/jellyfin-tube-feeder:latest` | 3000 — the pod's `container_port` |
| `tubefeeder-ollama` | `docker.io/ollama/ollama:0.40.13` | 127.0.0.1:11434, pod-internal |

- **Secrets:** none. The image is public.
- **Volumes:** `ollama` (pool) — downloaded models. On first start the app asks Ollama
  to pull `service.config.model` (`gemma4:e2b`, ~7 GB); songs added before that finishes
  are written with fallback tags flagged for checking.
- **Binds:** `/pool/shared/media/Music/Children` → `/music`, read-write, `owner: 0`. The app
  runs as root inside the container, which is `svc-tubefeeder` on the host; the role hands
  the folder to it once. Jellyfin reads it through the media tree's other-read bits, like
  everything else in `/pool/shared/media`.
- **Backup:** none. The songs are in the media tree, and the app's state is the MP3 tags.
- **Updates:** both containers `AutoUpdate=registry`; CI rebuilds the app image weekly so
  yt-dlp keeps up with YouTube.
- **Memory:** Ollama holds ~6 GB while tagging and frees it 5 minutes after the last song.
