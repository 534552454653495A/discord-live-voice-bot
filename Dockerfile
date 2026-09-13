# Linux runtime: Node 22 + ffmpeg (comes with the ffmpeg-static package) + yt-dlp (for music).
# The Chatterbox local TTS is not part of this image; point LOCAL_TTS_URL at an external server if you need it.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# yt-dlp: needs python3; installed through the package manager (the automatic tools/bin download works too).
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 ca-certificates curl \
	&& curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
	&& chmod +x /usr/local/bin/yt-dlp \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY data/.gitkeep ./data/.gitkeep

ENV YTDLP_PATH=/usr/local/bin/yt-dlp
# The panel binds to 127.0.0.1 only; to reach it from outside the container use PANEL=0 or a reverse proxy.
VOLUME ["/app/data"]

CMD ["node", "src/index.js"]
