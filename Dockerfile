FROM oven/bun:1.3-debian AS base
WORKDIR /app

FROM base AS ui
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY vite.config.ts ./
COPY ui ui
RUN bun run build:ui

FROM base AS runtime
ARG DEBIAN_FRONTEND=noninteractive
# ffmpeg converts audio and writes tags; curl fetches yt-dlp and serves the health check.
RUN apt-get update && \
    apt-get -y install --no-install-recommends ffmpeg curl ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
# Deliberately the latest yt-dlp: YouTube breaks old versions. CI rebuilds the image weekly.
RUN curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux && \
    chmod +x /usr/local/bin/yt-dlp
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server server
COPY --from=ui /app/dist/ui dist/ui
ENV LIBRARY_DIR=/music PORT=3000
EXPOSE 3000
HEALTHCHECK CMD curl -fs http://127.0.0.1:3000/health || exit 1
CMD ["bun", "server/main.ts"]
