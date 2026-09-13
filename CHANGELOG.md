# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.1] — 2026-09-13

### Fixed

- **Member lookup ignored Discord ids.** A name, a nickname and a similarity score were all it tried, so
  `user_info` with a raw user id or a `<@id>` mention answered "I could not find anyone called that" —
  which is exactly what the assistant sends when it wants to check who the owner is. Ids, mentions and a
  direct cache hit are now resolved before any name matching, and `user_info` with no member falls back
  to whoever is speaking instead of searching for an empty string.
- The assistant looked identity questions up with a tool although it is already told who is speaking, and
  it refused owner-only requests in advance rather than letting the gate decide. Its instructions now say
  to answer "who am I" from the speaker context, and to call the tool and report a refusal only when the
  gate itself returns one.

## [1.5.0] — 2026-09-13

### Added

- **Several servers at once.** `GUILD_ID` and `CHANNEL_ID` remain the primary server; `VOICE_TARGETS`
  adds more as a comma-separated list of `guildId:channelId` pairs. Each server gets its own
  conversation, model session, audio path, music queue and speaker attribution, so a command spoken in
  one server cannot authorise anything in another. `/join` in a server that is not listed builds a
  session for it on the spot, and a permanent `leave` drops an extra server's session while the primary
  one behaves exactly as before.
- `MAX_LIVE_SESSIONS` (default 2) caps how many servers may hold an open realtime session at the same
  time, because cost scales with that number. The check sits where the socket is opened, so every path
  into a connection passes it; a server over the cap stays quiet, keeps its tools and music, and takes
  its turn when a session closes. `/status` and the panel say which server is silent and why.
- `/status` and the panel list every session, activity events carry the server they came from, and
  `/metrics` gains `sessions_total` and `sessions_live`.

### Fixed

- The speaker announcement bookkeeping marked a speaker as "already told to the model" even when the
  announcement had been skipped for a crowded channel. Once the other speakers fell out of the twenty
  second window the line labelling stopped as well, and the assistant carried on a whole conversation
  without knowing who it was talking to.
- Memory search dropped every query shorter than three letters, which in Turkish removes ordinary words
  such as "ev" and "su", and it could not match a keyword that sat at the very end of a note.
- A channel edit is three separate API calls. When one of them failed after another had succeeded the
  tool reported a flat failure, sending the speaker to look for a change that had in fact been made; it
  now says what went through and what did not.

## [1.4.0] — 2026-09-13

### Added

- **Channels can be moved and reorganised by voice.** `edit_channel` now takes `parent` (move the channel
  into a category, or a word meaning "none" to take it out), `position` (0 is first, a large number is
  last) and `sync_permissions` (drop the channel's own overrides and follow its category). `list_channels`
  reports the categories and which channels sit in each, so the assistant can name them.
- **`voice_disconnect`**: throws somebody out of the voice channel without removing them from the server.
  It is deliberately separate from `kick_member`, and both descriptions now say which is which.
- **Memory search.** `recall_notes` takes a `search` argument that looks through the notes of everybody,
  matching whole words, so "what do you remember about X" no longer depends on guessing whose note it is.
  The assistant is also told to save a stated preference straight away and to search before saying it does
  not remember something.
- `YTDLP_AUTO_DOWNLOAD` (default on): turn it off to install yt-dlp yourself rather than have the bot
  fetch a binary from GitHub and run it.

### Fixed

- `voice_mute` called `member.voice.setDeafen`, which does not exist in discord.js, so the whole tool threw
  and nobody could be muted. The method is `setDeaf`.
- **Speaker attribution in a busy channel.** The running "now speaking: X" commentary flipped many times a
  minute and was often wrong for the sentence being answered. Once three or more people have been heard in
  the last twenty seconds it is dropped, and each finished transcript line is labelled with the speaker
  resolved from its position in the audio instead.
- **Untrusted text no longer reaches the model's instruction channel.** Transcript lines, the wake-word
  nudge, display names, the channel roster and saved notes are somebody else's words; they go on the
  thinking channel now, with newlines and control characters stripped, so a nickname or a note cannot
  read as a new instruction.
- **`RECORD_TRANSCRIPTS=0` now really keeps text off disk.** Only three event kinds went through the
  redacting path, so the owner's words behind a gate decision, a tool's arguments (a DM body, a note) and
  a spoken music query were still written to `data/activity.jsonl` and served by the export endpoint.
  Redaction moved into `ActivityLog`, which every producer has to pass through.
- **`use_bot` was ungated**: it relays a command that another bot executes with this bot as the requester,
  so an allow-listed moderation bot turned it into a way around the owner gate. It is owner-gated now.
- **`remember_note` could write a note about somebody else**, which is replayed to the model whenever that
  person speaks. A note about anyone but the speaker now needs the owner, as `forget_note` already did.
- **`play_music` accepted any link**, so a member could make the bot fetch an address on the owner's own
  network, and yt-dlp's stderr came back as spoken text. Links are restricted to known media hosts and
  failures are reported in the bot's own words.
- The music queue had no cap and the reply limiter had no process-wide budget; the speech server inherited
  the Discord token and the API keys it has no use for; `.gitignore` covered three `.env` spellings.
- Relative channel targets ("the room below") are matched in English as well as the active language,
  because the tool schemas are English and the model translates the phrase before sending it.

### Changed

- `src/guildsession.js`: every per-guild piece of state (mixer, playback, attribution, music, the local
  brain, reconnect and turn bookkeeping, speaker state and the tool dependencies) moved out of the
  orchestrator into a `GuildSession`. `src/index.js` went from 1726 lines to 447 and now holds only
  configuration, the shared services, event routing, the panel and shutdown. Behaviour is unchanged; this
  is the groundwork for serving more than one server at a time.

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
