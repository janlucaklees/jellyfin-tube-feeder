/** Runtime configuration, all from the environment. */
export const config = {
  libraryDir: process.env.LIBRARY_DIR ?? "/music",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  model: process.env.MODEL ?? "gemma4:e2b",
  port: Number(process.env.PORT ?? 3000),
};
