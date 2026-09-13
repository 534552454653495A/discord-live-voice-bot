# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — 2026-09-13

### Added

- **English and Turkish localisation.** Every user-visible string (console output, spoken replies, the
  admin panel, slash command descriptions and the assistant's default instructions) now comes from
  `src/locales/<code>/` through `src/i18n`. `BOT_LANGUAGE` selects the language and defaults to `en`;
  spoken-command matching and the owner-gate keyword lists follow it. Model-facing tool schemas stay in
  English on purpose — they are an API contract, not UI.
- **Channel permission tool** (`set_channel_permission`): open, close or reset per-role, per-member or
  `@everyone` permissions on a channel by voice — view, connect, speak, send, history, attach, links,
  reactions, stream, mute, move, manage messages, manage channel, invite. `only: true` expresses
  "only this role may join this room" by denying the same permissions for `@everyone`, while keeping the
  bot's own access. Server-level and dangerous permissions (Administrator, Manage Roles, ban/kick) are
  deliberately not reachable this way, a blanket reset for `@everyone` is refused so a hidden channel
  cannot be exposed by accident, and the bot refuses to set a permission it does not hold itself.
- **Reading older messages.** `read_messages` previously returned only messages that arrived after the
  bot started. It now accepts `all: true` for the last N messages regardless of the read cursor, and
  `before` to page further back. With no new messages it says so and offers the history.
- `VOICE_ECHO_TEXT_REPLIES` (default off): written replies to channel mentions are no longer read out
  loud in the voice channel.

### Fixed

- **Owner gate: the decision is pinned to the request that produced it.** The gate resolved the current
  "turn" at evaluation time, so any owner utterance during the model's latency window — or during the
  1.5 s wait for a late transcript — could validate a request that somebody else had made. Turns are now
  captured when the request arrives (per utterance for the local brain, per delegation id for the
  realtime backend) and carried through to the tool call.
- **Owner gate: it asks who said the command, not who spoke last.** A command used to be rejected
  whenever anyone made a noise while the backend was working ("I can't hear the owner right now"). The
  gate now checks who most recently said the command word and whether anyone spoke between that command
  and the model's answer; interjections after the model starts working no longer cancel a valid command,
  and a non-owner still cannot ride on the owner's earlier keyword.
- **Speaker announcements follow the audio that was actually sent** — the owner while they hold
  priority, otherwise the loudest active speaker — and need 160 ms of stability, with up to 300 ms of
  packet jitter tolerated. Previously a single short interjection could make the assistant believe
  someone else was talking.
- `grant_role` / `revoke_role` refused to touch the server owner, claiming Discord forbids it. Discord's
  rule is about the *role's* position, not the target member, so roles can now be granted to the server
  owner and to members ranked above the bot.
- Being addressed by name with a request ("Aria, ban Dana") produced "yes?" instead of the action; the
  nudge sent to the model now distinguishes a bare call from a call carrying a request.
- `set_music_volume` printed nothing to the console, so "I turned it up" could not be verified. Volume,
  pause and resume are now logged, and the tool reports the previous and the new level.
- The owner gate keeps a command valid for up to 60 s when the assistant asked a follow-up question and
  nobody else spoke in between ("which role?" → "chill").

## [1.2.0] — 2026-09-13

### Added

- **Local brain — voice chat without OpenAI.** Ears are faster-whisper (`/stt` on the Chatterbox
  server), the brain is any OpenAI-compatible chat model with the full tool set and the owner gate, and
  the mouth is Chatterbox. `BRAIN_MODE=auto` switches over on a credit or key failure and switches back
  when the API recovers.
- `src/localstt.js` (per-speaker energy segmentation and downsampling), `src/localbrain.js`
  (conversation history, reply policy, tool loop) and `src/localserver.js`, which starts the Chatterbox
  server on demand using `.venv-chatterbox` and retries every 15 s until it is ready.

### Fixed

- The assistant could not tell people apart: speaker names, owner status and stored notes are now sent as
  context, and the channel roster is announced on join and on membership changes.
- Chatterbox on low-memory machines: weights are streamed from disk straight into GPU parameters,
  large checkpoints are memory-mapped, CUDA libraries are located automatically, STT falls back to CPU,
  and a memory pre-flight check runs before loading.
- Permanent realtime failures (exhausted credit, invalid key) caused a reconnect storm and a flood of raw
  JSON. They are now classified, explained in one line, retried every 10 minutes, and reported once to
  the owner by DM.

## [1.1.0] — 2026-09-12

### Added

- **Music player** with ducking: yt-dlp and ffmpeg, search or link, a queue, local files via `MUSIC_DIR`,
  eight tools and a `/music` command. The music level drops while the bot speaks and returns afterwards.
- **Per-person memory** (`data/memory.json`) and **conversation summaries**.
- **Authorisation layer** for slash commands and the panel, a **daily realtime budget**, and privacy
  controls (`RECORD_TRANSCRIPTS`, `JOIN_NOTICE`).
- Panel additions: `/healthz`, Prometheus `/metrics`, JSONL export, date filtering, Host-header checks.
- Documentation, GitHub Actions CI, a Dockerfile, unit tests and an offline self-test.

### Fixed

- Tools disappeared entirely when DeepSeek was configured; the provider abstraction in `src/provider.js`
  keeps them on the Responses backend.
- The owner gate compared against a stale 400-character buffer instead of timestamped words.
- `lock_channel` deleted the whole `@everyone` overwrite when unlocking, which exposed hidden channels.
- Several spoken-command patterns matched ordinary words; playback buffering swallowed the start of
  sentences; the panel rendered display names as HTML.

## [1.0.0] — 2026-09-11

Initial version: realtime voice conversation in a Discord voice channel, a speaker mixer with owner
priority, the 20 ms audio bridge, character personas, written replies to DMs and mentions, and the first
set of Discord tools.
