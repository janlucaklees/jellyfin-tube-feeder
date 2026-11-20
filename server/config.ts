/** Runtime configuration, all from the environment. */
export const config = {
  libraryDir: process.env.LIBRARY_DIR ?? "/music",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  model: process.env.MODEL ?? "gemma4:e2b",
  port: Number(process.env.PORT ?? 3000),
  /** Optional: with an API key, Jellyfin is told about every changed song. */
  jellyfinUrl: process.env.JELLYFIN_URL ?? "",
  jellyfinApiKey: process.env.JELLYFIN_API_KEY ?? "",
  /** The library directory as Jellyfin sees it. */
  jellyfinLibraryPath: process.env.JELLYFIN_LIBRARY_PATH ?? "",
};
