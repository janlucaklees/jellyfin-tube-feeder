FROM oven/bun:1.3-debian

ARG DEBIAN_FRONTEND=noninteractive

# ffmpeg converts audio and embeds the cover; curl fetches yt-dlp.
RUN apt-get update && \
    apt-get -y install --no-install-recommends ffmpeg curl ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# yt-dlp is deliberately the latest standalone release: YouTube changes often and
# old yt-dlp versions stop working. Rebuild the image (`mise run build`) to update.
RUN curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux && \
    chmod +x /usr/local/bin/yt-dlp

# The container runs as the host user, who has no home inside the image.
ENV HOME=/tmp

WORKDIR /app
