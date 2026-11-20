import { createSignal, createStore, For, onSettled, Show } from "solid-js";
import { api, type Job, type ServerEvent, type Song } from "./api";
import { JobCard } from "./JobCard";
import { SongCard } from "./SongCard";

export function App() {
  const [songs, setSongs] = createSignal<Song[]>([]);
  const [jobs, setJobs] = createStore<{ list: Job[] }>({ list: [] });
  const [links, setLinks] = createSignal("");
  const [error, setError] = createSignal("");

  const loadSongs = () => api.songs().then(setSongs, (e: Error) => setError(e.message));

  const onEvent = (event: ServerEvent) => {
    if (event.type === "songs") return void loadSongs();
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

  onSettled(() => {
    void loadSongs();
    return api.events(onEvent);
  });

  // Finished jobs show up as songs; the job card only stays while there is something to see.
  const visibleJobs = () => jobs.list.filter((j) => j.state !== "done");

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    try {
      const queued = await api.addLinks(links());
      if (queued.length === 0) setError("Keine neuen YouTube-Links gefunden.");
      else setLinks("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main>
      <header>
        <h1>Tube Feeder</h1>
        <p>YouTube-Links einfügen, fertig getaggte Lieder landen in Jellyfin.</p>
      </header>

      <form class="paste" onSubmit={submit}>
        <textarea
          placeholder="https://www.youtube.com/watch?v=…&#10;Ein Link pro Zeile, oder einfach alles hineinkopieren."
          value={links()}
          onInput={(e) => setLinks(e.currentTarget.value)}
          rows={4}
        />
        <div class="row">
          <Show when={error()}>{(message) => <span class="error">{message()}</span>}</Show>
          <button type="submit" disabled={!links().trim()}>
            Hinzufügen
          </button>
        </div>
      </form>

      <Show when={visibleJobs().length > 0}>
        <section class="jobs">
          <For each={visibleJobs()} keyed={(j) => j.id}>
            {(job) => <JobCard job={job()} />}
          </For>
        </section>
      </Show>

      <section class="songs">
        <h2>Lieder ({songs().length})</h2>
        <For each={songs()} keyed={(s) => s.videoId} fallback={<p class="empty">Noch keine Lieder.</p>}>
          {(song) => <SongCard song={song()} />}
        </For>
      </section>
    </main>
  );
}
