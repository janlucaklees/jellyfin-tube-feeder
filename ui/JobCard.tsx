import { Show } from "solid-js";
import { api, type Job, type JobState } from "./api";

const LABEL: Record<JobState, string> = {
  queued: "Wartet",
  fetching: "Lese Videoinfos",
  tagging: "KI ermittelt Tags",
  downloading: "Lade herunter",
  writing: "Schreibe MP3",
  done: "Fertig",
  duplicate: "Schon in der Bibliothek",
  failed: "Fehlgeschlagen",
};

const STEPS: JobState[] = ["queued", "fetching", "tagging", "downloading", "writing", "done"];

export function JobCard(props: { job: Job }) {
  const progress = () => Math.max(0, STEPS.indexOf(props.job.state)) / (STEPS.length - 1);
  const finished = () => props.job.state === "failed" || props.job.state === "duplicate";

  return (
    <article class={["job", props.job.state]}>
      <div class="job-head">
        <a href={props.job.url} target="_blank" rel="noreferrer">
          {props.job.title ?? props.job.url}
        </a>
        <span class="state">{LABEL[props.job.state]}</span>
      </div>
      <Show when={!finished()}>
        <div class="bar">
          <div style={{ width: `${progress() * 100}%` }} />
        </div>
      </Show>
      <Show when={props.job.error}>{(error) => <pre class="error">{error()}</pre>}</Show>
      <Show when={finished()}>
        <div class="row">
          <Show when={props.job.state === "failed"}>
            <button onClick={() => api.retry(props.job.id)}>Nochmal versuchen</button>
          </Show>
          <button class="quiet" onClick={() => api.dismiss(props.job.id)}>
            Ausblenden
          </button>
        </div>
      </Show>
    </article>
  );
}
