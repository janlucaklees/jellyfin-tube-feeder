import { createSignal, createStore, For, onSettled, reconcile, Show } from "solid-js";
import { parseLinks } from "../server/links";
import { api, type Job, type ServerEvent, type Song } from "./api";
import { JobCard } from "./JobCard";
import { SongCard } from "./SongCard";

export function App() {
  // A store reconciled by video id: a song whose fields did not change keeps its
  // identity, so its card (and any unsaved typing in it) survives other songs changing.
  const [songs, setSongs] = createStore<{ list: Song[] }>({ list: [] });
  const [jobs, setJobs] = createStore<{ list: Job[] }>({ list: [] });
  const [links, setLinks] = createSignal("");
  const [error, setError] = createSignal("");

  const loadSongs = () =>
    api.songs().then(
      (list) =>
        setSongs((s) => {
          reconcile(list, "videoId")(s.list);
        }),
      (e: Error) => setError(e.message),
    );

  const onEvent = (event: ServerEvent) => {
    // "jobs" is the first message of every (re)connect: songs may have changed meanwhile.
    if (event.type === "songs" || event.type === "jobs") void loadSongs();
    if (event.type === "songs") return;
    setJobs((s) => {
      if (event.type === "jobs") s.list = event.jobs;
      else if (event.type === "job-removed") return { list: s.list.filter((j) => j.id !== event.id) };
      else {
        const index = s.list.findIndex((j) => j.id === event.job.id);
        if (index >= 0) s.list[index] = event.job;
        else s.list.push(event.job);
      }
    });
  };

  onSettled(() => api.events(onEvent));

  // Finished jobs show up as songs; the job card only stays while there is something to see.
  const visibleJobs = () => jobs.list.filter((j) => j.state !== "done");

  // Typing pauses this long before a complete-looking link is sent; a paste goes at once.
  const TYPING_PAUSE_MS = 600;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let sending = false;

  const add = async (text: string, auto: boolean) => {
    clearTimeout(pending);
    if (sending) return;
    if (parseLinks(text).length === 0) {
      if (!auto) setError("Das ist kein YouTube- oder Spotify-Link.");
      return;
    }
    sending = true;
    setError("");
    try {
      const queued = await api.addLinks(text);
      setLinks("");
      if (queued.length === 0) setError("Schon in der Bibliothek oder in Arbeit.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      sending = false;
    }
  };

  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    const text = e.currentTarget.value;
    setLinks(text);
    clearTimeout(pending);
    if (parseLinks(text).length === 0) return;
    const delay = e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop" ? 0 : TYPING_PAUSE_MS;
    pending = setTimeout(() => void add(links(), true), delay);
  };

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    void add(links(), false);
  };

  return (
    <main>
      <header>
        <h1>Tube Feeder</h1>
        <p>YouTube- oder Spotify-Link einfügen, das fertig getaggte Lied landet in Jellyfin.</p>
      </header>

      <form class="paste" onSubmit={submit}>
        <div class="row">
          <input
            type="text"
            inputmode="url"
            placeholder="YouTube- oder Spotify-Link einfügen – startet von selbst"
            value={links()}
            onInput={onInput}
          />
          <button type="submit" disabled={!links().trim()}>
            Hinzufügen
          </button>
        </div>
        <Show when={error()}>{(message) => <p class="error">{message()}</p>}</Show>
      </form>

      <Show when={visibleJobs().length > 0}>
        <section class="jobs">
          <For each={visibleJobs()} keyed={(j) => j.id}>
            {(job) => <JobCard job={job()} />}
          </For>
        </section>
      </Show>

      <section class="songs">
        <h2>Lieder ({songs.list.length})</h2>
        <For each={songs.list} keyed={(s) => s.videoId} fallback={<p class="empty">Noch keine Lieder.</p>}>
          {(song) => <SongCard song={song()} />}
        </For>
      </section>
    </main>
  );
}
