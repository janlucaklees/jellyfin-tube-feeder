> Archived 2026-11-24: historical record of a decision, not current behaviour. Do not edit.

# Spotify links — design (short)

## Intent
JLK's wife wants songs she knows from Spotify in the family Jellyfin library, including ones
that cannot be bought. Paste a Spotify song link, get the same well-tagged MP3 as for YouTube.

## Goals / non-goals / anti-goals
- Goal: `open.spotify.com/track/…` (also `/intl-xx/`, `spotify:track:…`) is accepted like a
  YouTube link and starts by itself.
- Goal: tags come from Spotify (artist, title, Spotify's album, year, cover). No AI tagging.
- Non-goal: albums, playlists, artist pages. Single songs only (JLK).
- Anti-goal: a wrong recording. If no exact match is found, the job fails (JLK).
- Anti-goal: breaking Spotify's DRM. Audio never comes from Spotify.

## Approaches
- Audio straight from Spotify (zotify/librespot): breaks DRM, risks the account. Rejected.
- Record the official client in real time: clean but heavy and fragile on a server. Rejected for now.
- **Spotify details + audio from YouTube Music, then SoundCloud** (picked): same toolchain the
  app already has (yt-dlp).
- Details via the official Web API: since Feb 2026 needs a Premium-owned dev app and dropped
  ISRCs. Rejected. **Public song page** instead (picked).

## Design
1. Spotify page → details. Parsed from the page's Open Graph / `music:*` meta tags (the
   link-preview contract). If any of title, artist, album, duration is missing, the page's
   text goes to the local Ollama model with a schema, so a markup change degrades to the AI
   instead of breaking (JLK: "maybe we do need an LLM after all").
2. Search YouTube Music (songs) for "artist title"; else SoundCloud. A candidate is exact
   when its title matches (case, punctuation and "feat." parts ignored), Spotify's first
   artist is among its artists, and its length is within 3 s. First exact candidate wins.
3. Download its audio, Spotify's cover, write tags, place as usual. Identity is the Spotify
   track id (stored in the existing `TUBEFEEDER_VIDEO_ID` field), so a pasted song is not
   downloaded twice.

## Calls left to the builder (made)
- Multiple artists: artist tag is Spotify's list joined with ", ".
- Spotify songs get no "ask the AI again" box; their tags are Spotify's, editable by hand.
- The failure message lists the closest candidates, so a YouTube link can be pasted by hand.
