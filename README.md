# Discord Live Voice Bot

A Discord bot that **listens to a voice channel, talks back in real time, and actually operates your
server** — it can send messages, move people, hand out roles, edit channel permissions, ban, play music
and remember things about the people it talks to, all from spoken conversation.

Speech goes straight to a realtime model over a WebSocket (no push-to-talk, no wake-word gate), and every
destructive action is locked behind a voice-based owner gate that proves *who actually said the command*.

[![CI](https://github.com/534552454653495A/discord-live-voice-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/534552454653495A/discord-live-voice-bot/actions/workflows/ci.yml)

---

## What it does

- **Real-time voice conversation.** Opus from Discord is decoded, mixed and streamed to the model as
  24 kHz PCM in 20 ms frames; the reply is streamed back the same way. Typical latency from "user stops
  talking" to "first audio out" is around one second.
- **115 server tools, 65 of them owner-gated.** Messages, DMs, members, roles, channels and their
  layout and permissions, threads and forum posts, reactions, pins and polls, emoji and stickers,
  scheduled events, auto-moderation, webhooks, moderation, invites, the audit log, server settings,
  music with saved lists, reminders, drawing, notes and conversation summaries.
- **Its own music player.** yt-dlp + ffmpeg, search or direct link, queue, and automatic **ducking** —
  the music drops while the bot speaks and comes back when it stops.
- **Per-person memory.** "Remember that my cat is called Smoke" is stored per user and quietly handed to
  the model the next time that person speaks.
- **Knows who is talking.** The owner's voice is given priority on the audio path, and the assistant is
  told the name of whoever it is currently hearing.
- **Offline fallback ("local brain").** If the realtime API is out of credit or unreachable, the bot can
  keep talking using local Whisper for ears, any chat model for the brain, and Chatterbox for the voice.
- **Local admin panel** on `127.0.0.1:8787` with a live activity log, `/healthz` and Prometheus `/metrics`.
- **Several servers at once.** Each one gets its own conversation, model session, audio path and music,
  and the owner gate is per server.
- **English and Turkish.** Every user-visible string lives in `src/locales/`; `BOT_LANGUAGE` picks one.

## What it is not

It is one process, not a hosted service: the bot runs on your machine and talks to the model APIs directly
with your own keys, and nothing is transcribed to disk unless you allow it (`RECORD_TRANSCRIPTS=0` keeps
transcripts and message text out of the log file and only counts the events). Serving several servers costs
one realtime session per server, which is what `MAX_LIVE_SESSIONS` is there to bound.

---

## How it works

```
Discord voice  ──Opus──▶  decode ──▶ SpeakerMixer ──▶ AudioBridge ──20 ms──▶  GPT-Live (WS)
  (per user)                          owner priority      ▲    │                   │
                                                          │    │            transcript + audio
                                       music (ducked) ────┘    │                   │
                                                               │                   ▼
Discord voice  ◀──Opus──  encode  ◀── PlaybackQueue ◀──────────┴──────────  tool calls
                                                                                   │
                                                                    ┌──────────────┴───────────────┐
                                                                    │  Responses backend + tools   │
                                                                    │  (owner gate, web search)    │
                                                                    └──────────────────────────────┘
```

The bot never sends audio through ffmpeg on the voice path — resampling and mixing are small integer
routines in `src/audio.js`, which is what keeps the loop inside one 20 ms frame.

**The owner gate.** Voice is not an identity: anyone can say "ban him". The gate answers a narrower
question — *who said the command word?* Transcript fragments are attributed to a speaker by their
position in the audio stream, the moment the model starts answering is recorded as a "turn", and a
gated tool runs only if:

1. the person who **most recently** said the command word (ban / role / channel / move …) is the owner, and
2. nobody else spoke between the owner's command and the model starting its answer.

Interjections *after* the model starts working do not change the decision, and the decision is pinned to
the request that produced the tool call — so a later "okay" from the owner cannot retroactively authorise
somebody else's request. Irreversible actions (channel/role deletion, ban, kick, timeout on a fuzzy name
match) additionally require a spoken confirmation.

---

## Requirements

- **Node.js 22.12+** (also tested on 24)
- A **Discord application** with a bot token
- An **OpenAI API key** with access to the realtime model
- Optional: a **DeepSeek** key (written replies), **Python 3** + a CUDA GPU (local brain)

ffmpeg ships with the project (`ffmpeg-static`); yt-dlp is downloaded into `tools/bin/` on first use.

## Setup

```bash
git clone https://github.com/534552454653495A/discord-live-voice-bot.git
cd discord-live-voice-bot
npm install
cp .env.example .env                                  # fill in the four required values
cp data/characters.example.json data/characters.json  # optional: a persona to start from
npm start
```

The four values that must be set are `DISCORD_TOKEN`, `GUILD_ID`, `CHANNEL_ID` and `OPENAI_API_KEY`.
Everything else has a working default; the file documents each option. Without a character file the
bot uses the built-in instructions, and personas can be created from the panel or `/character`.

**Discord application setup**

1. <https://discord.com/developers/applications> → *New Application* → *Bot* → *Reset Token*.
2. Under *Privileged Gateway Intents*, enable **Message Content**, **Server Members** and **Presence**
   if you want the bot to read messages, resolve member names and see activity. The bot detects which
   intents it was granted and degrades gracefully if you leave them off.
3. Invite it with the `bot` and `applications.commands` scopes, plus the permissions you actually want it
   to have. Role and channel tools only work for roles below the bot's own highest role.
4. Copy the server ID and the voice channel ID (Developer Mode → right-click → *Copy ID*).

**Owner.** Set `OWNER_ID` to your own user ID. Leaving it empty disables every voice admin tool — there
is no default owner.

### Docker

```bash
docker build -t discord-live-voice-bot .
docker run --env-file .env -v "$(pwd)/data:/app/data" discord-live-voice-bot
```

The image bundles Node 22, ffmpeg and yt-dlp. The local Chatterbox voice is *not* included; point
`LOCAL_TTS_URL` at a server outside the container if you want it.

---

## Talking to it

Say the assistant's name and it answers. A handful of phrases are matched locally, by grammar defined in
the active locale, so they work even when the tool backend is disabled:

| You say | It does |
| --- | --- |
| "play Rammstein Puppe" | Plays or queues a track |
| "stop the music", "pause", "resume", "skip the song", "turn the music down", "what's playing" | Music control |
| "write hello in the general channel" | Posts a message |
| "read the general channel" / "what's written in general" | Reads out recent messages |
| "join the lounge channel" / "leave the channel" | Moves between voice channels |
| "switch to the Aria character" | Changes the active persona |

Everything else goes to the assistant, which decides whether to call a tool, search the web or simply
answer. That is where the rest of the surface lives:

| You say | It does |
| --- | --- |
| "remember that my cat is called Smoke" | Stores a note about you, recalled next time you speak |
| "what was said today" | Summarises the recent conversation |
| "who joined the server last?" | Reads the channel you point it at and answers |
| *(owner)* "ban him", "give Ali the chill role", "lock the channel", "only the chill role can join this room" | Admin tools, owner voice only |
| *(owner)* "move this channel under Lounge", "put it at the bottom", "throw him out of voice" | Channel layout and voice moderation |

## Several servers at once

`GUILD_ID` and `CHANNEL_ID` are the primary server. Add more with `VOICE_TARGETS`:

```
VOICE_TARGETS=987654321098765432:111222333444555666,876543210987654321:222333444555666777
```

Every server gets its own conversation, model session, audio path, music queue and speaker attribution, so
a command spoken in one cannot authorise anything in another. `/join` in a server that is not listed builds
a session for it without a restart.

Each open conversation is a separate realtime session, so cost grows with the number of them.
`MAX_LIVE_SESSIONS` (default 2) bounds how many may be connected at once. A server over the cap still runs
its tools and plays music, it just stays quiet until a slot frees up, and `/status` and the panel say so.

### Slash commands

`/join` `/leave` `/panel` `/character` `/send` `/read` `/status` `/music` `/summary` `/recording` `/help`

Administrative ones (`/leave`, `/character`, `/send`, `/read`, `/recording`, and panel edits) are limited
to the owner, `ADMIN_USER_IDS`, `ADMIN_ROLE_IDS`, or members with *Manage Server*.

---

## Local brain (running without OpenAI)

When `BRAIN_MODE=auto` and the realtime API returns a credit or key error, the bot switches to a fully
local pipeline instead of going silent:

| Stage | Component |
| --- | --- |
| Ears | faster-whisper, served by `tools/chatterbox_server.py --stt` |
| Brain | any OpenAI-compatible chat model (DeepSeek by default), with the same tool set |
| Mouth | Chatterbox TTS, optionally cloning a reference voice |

```powershell
# one-off install into .venv-chatterbox (Windows, CUDA)
tools\setup-chatterbox.ps1
# the bot starts the server itself when it needs it; to run it by hand:
tools\run-chatterbox.cmd
```

Voice commands, tools and the owner gate all work in this mode. Web search does not.

## Admin panel

`http://127.0.0.1:8787` — bound to loopback only, with a Host-header check against DNS rebinding.
It shows DMs and channel replies, voice transcripts, tool calls, gate decisions, latency, music and
memory, and can export the log as JSONL. `/healthz` returns a status object and `/metrics` exposes
Prometheus counters.

Set `PANEL=0` to turn it off, or `RECORD_TRANSCRIPTS=0` to keep message and transcript text out of
`data/activity.jsonl` entirely (events are still counted).

---

## Configuration

Every option lives in `.env` and is documented in [`.env.example`](.env.example). The ones worth knowing:

| Variable | Default | What it controls |
| --- | --- | --- |
| `BOT_LANGUAGE` | `en` | Language of logs, speech, panel and voice-command matching (`en`, `tr`) |
| `VOICE_TARGETS` | *(empty)* | Extra servers, as `guildId:channelId` pairs separated by commas |
| `MAX_LIVE_SESSIONS` | `2` | How many servers may hold an open realtime session at once |
| `OWNER_ID` | *(empty)* | The only voice that may use admin tools; empty disables them |
| `OWNER_PRIORITY` | `1` | While the owner speaks, only their audio is sent to the model |
| `RESEARCH_MODEL` | *(empty)* | Enables the full tool set and web search through the Responses API |
| `DAILY_LIVE_SECONDS` | `0` | Daily realtime budget; `0` is unlimited |
| `MUSIC_VOLUME` / `MUSIC_DUCK_VOLUME` | `35` / `12` | Music level, and level while the bot speaks |
| `BRAIN_MODE` | `auto` | `auto` falls back to the local brain, `local` always, `live` never |
| `RECORD_TRANSCRIPTS` | `1` | Whether transcripts and message text are written to disk |

## Project layout

```
src/
  index.js        configuration, shared services, the session registry, event routing
  guildsession.js everything that belongs to one server: audio, session, tools
  live.js         GPT-Live WebSocket session and tool dispatch
  audio.js        mixing, resampling, ring buffers
  bridge.js       the 20 ms send/receive loop
  voice.js        voice connection, receivers, rejoin logic
  attribution.js  who said what (the basis of the owner gate)
  commands.js     slash commands and spoken-command grammar
  music.js        yt-dlp + ffmpeg player with ducking
  localbrain.js   offline chat loop      localstt.js  offline ears
  panel.js        local admin panel      memory.js    per-person notes
  tools/          the 115 model-callable tools
  locales/        en and tr string bundles
  i18n/           locale lookup
tools/            Chatterbox server and install scripts
test/             unit tests plus a full offline self-test
```

## Development

```bash
npm run lint      # oxlint, warnings are errors
npm run test:unit # node:test unit tests
npm run selftest  # end-to-end offline test with a mocked GPT-Live server
npm run check     # all of the above
```

The self-test runs the real audio path, the tool registry, the owner gate and a mock realtime server
without touching the network, so it is safe to run anywhere.

## Licence

MIT — see [LICENSE](LICENSE).
