import { createSignal, Show } from "solid-js";
import { api, type Song, type TagName } from "./api";

export function SongCard(props: { song: Song }) {
  // Drafts follow the song whenever the server sends a new version of it.
  const [artist, setArtist] = createSignal(() => props.song.artist);
  const [title, setTitle] = createSignal(() => props.song.title);
  const [album, setAlbum] = createSignal(() => props.song.album);
  const [year, setYear] = createSignal(() => props.song.year?.toString() ?? "");
  const [hint, setHint] = createSignal("");
  const [busy, setBusy] = createSignal("");
  const [error, setError] = createSignal("");

  const dirty = () =>
    artist() !== props.song.artist ||
    title() !== props.song.title ||
    album() !== props.song.album ||
    year() !== (props.song.year?.toString() ?? "");

  // A single's album is its title (the library's rule), so the album follows the title
  // for as long as the two are the same.
  const changeTitle = (next: string) => {
    if (album() === title()) setAlbum(next);
    setTitle(next);
  };

  const check = (tag: TagName) => props.song.fallbacks.includes(tag);

  async function run(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    try {
      await work();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  const save = (e: SubmitEvent) => {
    e.preventDefault();
    void run("Speichere…", () =>
      api.save(props.song.videoId, { artist: artist(), title: title(), album: album(), year: year() ? Number(year()) : null }),
    );
  };

  const ask = () =>
    void run("KI fragt nach…", async () => {
      await api.ask(props.song.videoId, hint());
      setHint("");
    });

  const remove = () => {
    if (confirm(`„${props.song.title}“ wirklich löschen? Die Datei wird entfernt.`)) {
      void run("Lösche…", () => api.remove(props.song.videoId));
    }
  };

  return (
    <article class="song">
      <img src={api.coverUrl(props.song)} alt="" loading="lazy" />
      <form onSubmit={save}>
        <label class={{ check: check("artist") }}>
          Interpret
          <input value={artist()} onInput={(e) => setArtist(e.currentTarget.value)} />
        </label>
        <label class={{ check: check("title") }}>
          Titel
          <input value={title()} onInput={(e) => changeTitle(e.currentTarget.value)} />
        </label>
        <label class={{ check: check("album") }}>
          Album
          <input value={album()} onInput={(e) => setAlbum(e.currentTarget.value)} />
        </label>
        <label class={["year", { check: check("year") }]}>
          Jahr
          <input value={year()} inputmode="numeric" onInput={(e) => setYear(e.currentTarget.value)} />
        </label>

        <Show when={props.song.fallbacks.length > 0}>
          <p class="hint-text">Markierte Felder hat die KI nicht sicher erkannt – bitte prüfen.</p>
        </Show>

        <div class="row">
          <button type="submit" disabled={!dirty() || !!busy()}>
            Speichern
          </button>
          <input
            class="ask"
            placeholder="Hinweis für die KI, z. B. „Interpret ist …“"
            value={hint()}
            onInput={(e) => setHint(e.currentTarget.value)}
          />
          <button type="button" disabled={!hint().trim() || !!busy()} onClick={ask}>
            KI nochmal fragen
          </button>
          <button type="button" class="quiet danger" disabled={!!busy()} onClick={remove}>
            Löschen
          </button>
        </div>
        <div class="meta">
          <Show when={busy()}>{(label) => <span>{label()}</span>}</Show>
          <Show when={error()}>{(message) => <span class="error">{message()}</span>}</Show>
          <a href={props.song.sourceUrl} target="_blank" rel="noreferrer">
            Video
          </a>
          <span title={props.song.file}>{props.song.file.replace(/^.*?\/(?=[^/]+\/[^/]+\/[^/]+$)/, "")}</span>
        </div>
      </form>
    </article>
  );
}
