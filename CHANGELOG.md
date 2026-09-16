# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.16.2] — 2026-09-16

### Fixed

- **Quiet was refused on the lines it is most often said in.** The grammar matched "sus", but a line that is
  not provably one person's refuses every command that is not harmless — and both "sus" lines in the live log
  were flagged mixed, so the one route that needs no model silently did nothing. Quiet passes that check now:
  the tool behind it is owner-gated (who said the word, and whether anybody spoke over it), which is exactly
  the second check the mixed rule exists to stand in for.
- **Some words the grammar listens for could not open the owner gate.** "kes sesini", "kapa çeneni" and
  "devam edebilirsin" were parsed and then refused as "the owner did not say the keyword", and the refusal is
  spoken — so asking to be quiet produced a sentence instead of silence. "kes", "kapa" and "edebilir" are gate
  words now, written as stems, so "kesin" and "kapat" stay out.
- **The quiet phrases have tests now** (the parser suite, both languages): the words that ask for silence, the
  way back, and the ones that must not match — "susma", "susmuyorum", "susam", "çok susadım", "the reading
  room is quiet".

## [1.16.1] — 2026-09-16

### Fixed

- **"Be quiet" switched nothing on.** The state existed — the owner held it, only the owner could lift it, and
  the audio was dropped while it lasted — but there was no way into it. The settings tool did not list `quiet`
  among the settings it knows, so the model never asked for it; the owner gate had no quiet word in its keyword
  list, so a call that did arrive would have been refused as "the owner did not say the keyword"; and no spoken
  pattern caught "sus" the way the music controls are caught. Heard live: the owner said "melis sus", the bot
  answered "Tamam, susuyorum", and it kept talking until it was told off for it.
  The settings tool now offers `quiet` and says what it does, the gate accepts the words that ask for it
  ("sus", "sessiz ol", "kes sesini"; "be quiet", "shut up") and the words that lift it ("konuşabilirsin",
  "speak again"), the standing instructions tell the model to call the tool the moment the owner asks instead
  of promising to go quiet, and the voice-command grammar carries the same words, so a clean line in the
  owner's own voice engages the state with no model involved at all. Going quiet and coming back each have
  their own short line instead of a setting name and a value.

## [1.16.0] — 2026-09-16

### Added

- **Being told to be quiet now says what quiet means for the conversation.** The instructions already
  said the bot must not speak while the owner's silence is on, and the application drops its voice
  anyway, but nothing said that the talk around it is not addressed to it, so a sentence carrying its
  own name could still read as an invitation to answer it. The note that goes out the moment the owner
  silences it now spells that out — the channel's talk belongs to the people having it, and it is not
  answered, commented on, or turned into a reason to speak when the name comes up — and the standing
  instructions carry the same judgement for the ordinary case: a request, a question or a remark aimed
  at the bot is for it, people talking among themselves is not, and it keeps listening instead of
  chipping in.
- **The local brain hears the silence too.** In local mode it used to reach only the audio path: the
  model was never told, and it kept generating answers that were dropped before anybody heard them. It
  is now given the same note the realtime session gets.

## [1.15.0] — 2026-09-15

### Changed

- **The same short line is not generated twice.** This bot says a handful of things all evening: "here",
  "all right", "what is it?". Each one cost seconds on the GPU every time, for audio that is identical.
  Lines under eighty characters are kept, sixty of them at a time, which is exactly the set that repeats.
  A repeat is now instant.
- **The first piece of a reply is cut at the earliest clean place** rather than at the full stop. The
  brain is asked for one short sentence, so waiting for the sentence to end means waiting for the whole
  reply, and streaming on its own bought nothing. It now starts speaking at the first comma, or failing
  that at the first word boundary past two dozen characters. Only the first piece: everything after it is
  generated while the previous piece plays, so there is nothing to gain there and prosody to lose.

## [1.14.2] — 2026-09-15

### Added

- **The local wait is reported in its three parts**: how long the ear took, how long until the first word
  of the reply, and how long the whole reply took. Two of the three happen on somebody else's machine, a
  remote text model and a local speech synthesiser, so knowing which one is the slow half is the whole of
  the answer to "can it be faster".
- **A sentence that takes longer to say than it lasts gets a line**, with both numbers.
- **The response time is measured in local mode too**, from somebody finishing speaking to hearing
  something back. The realtime path has always reported it; the mode where it matters most never did.

## [1.14.1] — 2026-09-15

### Fixed

- **The bot went permanently silent after a voice reconnect.** The connection dropped with close code
  4014, came back a second later, and nothing was heard again for the rest of the session while
  transcription and speech generation both kept reporting success. The stream the player reads the bot's
  voice from is destroyed by the drop, and a destroyed stream never plays again: every later write
  disappeared into it. It is now rebuilt whenever it dies, whether that shows up as a stream error, a
  player error, or the connection returning to ready with the old one already gone. Rebuilding is limited
  to once a second so a failing output cannot spin.

## [1.14.0] — 2026-09-15

### Changed

- **The local brain speaks while it is still thinking.** The reply used to be awaited in full and only
  then handed to the mouth, which already speaks sentence by sentence, so the entire generation time sat
  in front of the first word for no reason. Each piece now crosses as it arrives and the first sentence
  goes to Chatterbox while the rest is still being written. Tool calls arrive in the same stream and are
  stitched back together by index; a round that turns out to be a tool call still produces no speech,
  because the answer comes after the tool has run.
- **How long the local ear waits before deciding somebody stopped talking is a setting**,
  `LOCAL_STT_SILENCE_MS`, default unchanged at 700 ms. It sits in front of everything else in local mode,
  so it is the cheapest thing to trade against being cut off mid-sentence.

## [1.13.2] — 2026-09-14

### Changed

- **The realtime protocol's own events moved to their own switch, `DEBUG_LIVE`.** `DEBUG=1` is for
  reading what the bot decided about who said what; the wire is a different question and at several
  lines a second it buried the answer. Silencing one chatty event type at a time was not going to end,
  so the two are separate now.

## [1.13.1] — 2026-09-14

### Changed

- **The debug log no longer prints the streaming chunks.** With `DEBUG=1` every realtime event was
  printed, including the audio and transcript deltas that arrive many times a second, which buried the
  lines somebody turned the log on to read. Everything that happens once still appears: the session
  opening, a tool call, an error.

## [1.13.0] — 2026-09-14

### Added

- **"Me" is a person.** "Write to me", "my roles", "move me down": the bot answered that "me" does not
  appear as a name, which is true and beside the point. When no real member matches, a word for oneself
  now resolves to whoever is speaking, in every tool that takes a member. It is tried last, so somebody
  actually nicknamed "Ben" keeps the name they have.

## [1.12.2] — 2026-09-14

### Changed

- **The debug log answers the question people actually ask.** It used to print the audio position and
  whether the owner had spoken. With `DEBUG=1` it now says, for every transcript fragment, which stretch
  it was judged on, who the audio puts there, how sure that is and why, how much of it that person held
  alone, and everybody who was heard in it. Each finished line then gets its own line saying who it was
  given to, whether it was mixed, and who the candidates were. That is exactly the evidence needed to
  answer "it says the line is not one person's, but it was".

### Fixed

- **"What are my roles" failed.** The model calls member_roles with an empty name for that, and looking
  up an empty string failed with "I could not find anyone called ''". Empty now means the person
  speaking, as it already did for user_info.

## [1.12.1] — 2026-09-14

### Fixed

- **A confirmation could not be given.** Asked to delete a channel, the bot asked for confirmation, the
  owner gave it four times, and every attempt came back "I could not match that". An answer to a question
  that had expired threw the record away and refused, so the next attempt had nothing to match either,
  for ever. It now asks the question again, which is still two steps and still cannot act on its own.
  The window is ninety seconds rather than thirty, because half a minute is nothing in a voice channel.
- **Somebody talking quietly is recorded as talking.** The diagnostic showed fragments sitting two
  seconds past the last thing the bot had recorded while the speaker had never stopped: they were simply
  below the bar that counts as speech, and the model transcribes what it hears whether our own ear agreed
  or not. A frame where exactly one voice is present without clearing that bar is now recorded as a weak
  stretch: enough to put a name on a line, never enough to act on. Two quiet voices at once stay
  unrecorded, because that really is a guess.

## [1.12.0] — 2026-09-14

### Security

- **"Do not delete" was read as "delete".** Turkish builds the negative by gluing -ma/-me straight onto
  the verb, so the negated word contains the positive one and a prefix match finds it: "silme" starts
  with "sil". Heard live, "pardon, silme" sat in the owner's words while fifty more messages went. A word
  carrying the negative no longer counts as the command, in any keyword list, while the words that merely
  begin the same way still do: -meli is "should" and -mek is the infinitive, and neither is a negative.

### Fixed

- **The neighbourhood a fragment is answered from is now the measured size.** The diagnostic added in
  1.10.2 logged six of these with their numbers in one session: the fragment's window sat between 500 and
  1000 ms past the last audio heard, so half a second missed five of the six. It is a second and a half
  now. Widening it cannot put words in the wrong mouth, because a neighbourhood holding two voices still
  names nobody.
- **The model is told to actually call the tool when asked to play something**, not only when asked to
  skip or stop. It had answered "starting it now" twice with nothing playing.

## [1.11.1] — 2026-09-14

### Fixed

- **A private conversation now has a name.** It has no channel name, and every sentence about one came
  out with the placeholder still in it: "#{channel} history read: 10 messages". It is called after the
  person it is with.
- **Asked for a private conversation, the bot gives its latest messages.** The new-messages-only path
  makes no sense there: there is no baseline taken at startup, and after one read it answers "nothing
  new" to somebody pointing at a message they can see on their own screen.
- **An invented message id is ignored rather than obeyed.** The model passed one on the first read and
  the answer came back as "there are no messages", which is a lie about the conversation rather than
  about the id. Only something shaped like a real id is passed on.

## [1.11.0] — 2026-09-14

### Added

- **The bot can read a private conversation, not only send one.** "Read the DM I just sent you" was
  answered with "I could not tell which channel to read": reading was the one tool in the messaging
  family that could not look at a private conversation, though the same resolver was already there for
  editing and deleting. It now takes the same `dm` argument, including "last" for the conversation it was
  just in.
- **A personal status line.** Asked to set one, the bot answered that it could not, which was never true:
  a custom status is an activity whose text lives in the state field rather than in the name. It is now
  `set_bot_status(activity_type:"custom")`, with the spoken words for it in both languages.

Both were also written into the capability note the model is given, because a tool the model has not been
told about is a tool it will say it does not have.

## [1.10.2] — 2026-09-14

### Fixed

- **The bot's profile went on saying "listening to" after the music was stopped.** The only thing that
  ever took that back off was a track ending; stopping cleared the queue and the player without telling
  anybody. Stopping now reports the end the same way running out does, and says which of the two it was,
  so the log does not claim a stopped track "finished".
- **A track came back round on its own when it ended**, which from the outside looked like music that
  would not stop. The model had answered one "change it" by both skipping to a song and queueing it, so
  the queue held a second copy of what was already playing. A request for something already playing or
  already waiting is now answered rather than added twice.

### Added

- **A line with no audio under it now says where it looked**: the stretch it wanted, where the audio has
  got to, and where the last thing heard ended. Six times a session, which is enough to see the pattern.
  This is the third round of this particular question and it will not be guessed at again.

## [1.10.1] — 2026-09-14

### Fixed

- **"Skip the queue", asked four times in a row, was answered four times and never done.** The voice
  command shortcut refused every line that was not provably one person's, which in a lively channel is
  most of them, and music is what that shortcut is mostly used for. How clean a line has to be now follows
  what the command would do: playback and read-only requests may run off a line that is only mostly one
  person's, because the worst case is the wrong song. Posting a message, changing the persona or the
  privacy setting, and moving the bot between channels still need a line that is provably one person's,
  because there the worst case is somebody else's words acting under a name that is not theirs. A line
  nobody owns at all still runs nothing.
- **The model was told to actually call the tool** when somebody asks it to skip, stop, pause or change
  the volume. It had taken to saying "sure, skipping" without calling anything, which is the same as not
  doing it.

## [1.10.0] — 2026-09-14

### Fixed

- **"Two voices at once" was usually neither.** The diagnostic added in 1.9.2 gave it away on its first
  live run: the message named no candidates at all, which only happens when there was no audio recorded
  under those words. Discord sends no packets while somebody draws breath, so nothing is tracked in the
  pause between two of their own words, and a fragment landing there had nothing to resolve against. A
  fragment in a pause is now answered from the audio on either side of it, and only from the audio of one
  person: a pause between two different people still names nobody, and now names them as the candidates
  rather than saying "somebody". The two cases are also said differently, because they are different
  things to fix.
- **Inference never opens the gate.** An answer taken from around a pause carries a reason saying so, and
  the owner gate reads only answers taken from the audio under the words themselves. A tangled stretch
  answers "not the owner" rather than "no information", so it cannot fall through to the looser
  frame-level test. That fall-through was introduced by this change and caught by two existing tests.

### Note

- The windows on transcript fragments turn out to be **per fragment**, not cumulative: the probe added in
  1.9.2 reported nought out of twenty-four carrying the previous one. The 1.8.3 clamp is therefore a
  no-op in practice. It stays, because it costs nothing and is the correct handling if the shape ever
  changes, but the reasoning that motivated it was wrong.

## [1.9.2] — 2026-09-14

### Added

- **The bot says which shape the transcript time windows arrive in**, once per session, after enough
  fragments to be sure. Whose words a line is rests entirely on whether a fragment's window covers that
  fragment or the whole utterance so far, and which one it is had been worked out from a pattern across
  four lines of a log. The handling is correct either way, but a load-bearing inference should not stay
  an inference.
- **The overlap log line names the voices it could not tell apart.** "Two voices at once" on its own says
  nothing about whether the judgement was right, and after the fact the log is the only evidence there is.

## [1.9.1] — 2026-09-14

### Changed

- **Tests that were not testing what they claimed.** The rest of the adversarial review's findings, all
  in the suite rather than the code. Two property tests drew their randomness from an arithmetic that
  loses its low bits to floating point, so one branch of a coin flip came up once in two hundred draws
  instead of once in two, and the array surgery they exist to guard was almost never executed. The gate
  property test never once reached a state where the gate opens, so every assertion in it was skipped;
  it now shapes its input like a conversation and refuses to pass unless the gate opened at least twenty
  times. The line cap test was satisfied by the ordinary silence timer rather than the cap. Four rules
  had no test at all: the bridging pass in the run grouper, the punctuation half of "never cut inside a
  word", the announcement guard for a frame with two voices in it, and the refusal to run a command off a
  line that is only mostly one person's. A line's turn is now its own method so that it can be asserted
  on directly rather than through a stub.

## [1.9.0] — 2026-09-14

Five findings from an adversarial review of the per-speaker attribution work. Thirty-six agents across
five lenses; every finding below was independently reproduced before it was believed.

### Security

- **A voice too quiet to be called speech was treated as absent, not as an overlap.** Audio under the
  speech bar is still summed into the frame the model transcribes, but it never entered the speaker
  list, so a frame holding two voices was recorded as holding one person alone. Somebody could speak
  softly and have their words land under another person's name, with that person's authority behind
  them. The mixer now reports who is really in the frame, at a lower bar than speech, and "alone" means
  alone in the sound.
- **An interjection in another alphabet was invisible to the interjection check.** Tokens come from a
  normaliser that keeps only a-z0-9, so a sentence in Cyrillic, Greek, Arabic or Chinese tokenises to
  nothing; the check that catches somebody cutting in between the owner's command and the answer walked
  straight past it and found the owner's own earlier words instead. That was a way to get a ban past the
  gate by talking over the owner in another script. Real speech now counts as something said whether or
  not its letters survive normalising.

### Fixed

- **A line holding somebody else's words was handed to the model under one confident name.** The record
  was stamped uncertain and the command shortcut refused it, but the model, the one part that actually
  answers these lines, was told the flat sentence with the owner suffix on it. It is now told that a few
  words of somebody else's may have run into the line.
- **A speaker whose packets had stopped stayed in the speaking list for the full hold**, which wrote a
  stale second name onto the first fragment of the next person's turn. Staying now needs both halves:
  spoke recently, and packets still arriving.
- **The eight second line cap cut words in half.** It fired on whichever fragment happened to arrive, so
  "banla" could become "ban" and "la", and then the command parser recognises neither. It now waits for
  a fragment that ends where a line can end, and gives up waiting after twelve seconds.

## [1.8.4] — 2026-09-14

### Fixed

- **Two people in one channel can carry the same display name**, and then "X said this" identifies
  nobody. Seen live with the owner and another member showing as the same word. Where a name is shared
  by somebody else in the channel, the account name now goes with it, in what the model is told and in
  the log. Names nobody shares are left alone.

## [1.8.3] — 2026-09-14

### Fixed

- **Every line but the first in a flush read as "two voices at once".** The realtime API reports how far
  an utterance has got, not the stretch a single fragment covers, so the second fragment of a sentence
  comes back spanning the first one as well. Read literally, every fragment after the first carried the
  previous speaker's audio inside its own window: measured in a live session with three people, the
  second line of a flush was called an overlap four times out of four. A fragment is now judged on the
  audio that is new since the last one. Where the API does send a per-fragment window this changes
  nothing, because that window already starts where the last one ended.
- **Asking the bot to change its own name was refused as "the owner did not say the keyword".** Not one
  word in the identity vocabulary was a name. Turkish also drops the vowel in the possessive, so the
  bare stem never matched what was actually said.

## [1.8.2] — 2026-09-14

### Fixed

- **The bot lost pieces of its own speech.** A 20 ms stereo frame is 3840 bytes, so the output stream's
  default 16 KB cushion held about 85 ms: one garbage collection or one slow tick of the event loop
  overflowed it, and an overflowing output drops the bot's speech rather than delaying it. The cushion
  is now a third of a second, which rides out a hiccup while staying far too small to let stale audio
  pile up behind a real stall.
- **The stall message was misleading.** It reported a running total, so "501 frames dropped" two minutes
  into a session read as a ten second outage that had never happened. Each stall is now reported once,
  when it ends, with how much speech it actually cost.

## [1.8.1] — 2026-09-14

### Fixed

- **Everybody in a busy channel read as "talking at once", and no voice command ran.** Two causes, both
  introduced in 1.7.0/1.8.0. The mixer kept a speaker in its list for half a second after their last
  loud frame, so an ordinary handover between two people looked like an overlap; a quarter of a second
  between turns was enough. The hold is now 200 ms, which still covers the gaps between words and the
  jitter packets arrive with. A gap is excluded from the audible time anyway, so the long hold bought
  nothing and cost everything.
- **One contaminated fragment condemned the whole line it sat in.** A delta is shorter than a word and
  the first one of a turn lands while the previous speaker is still counted as talking, so judging a
  line by its worst fragment refused nearly every line. The fragments still decide where a line is cut;
  who owns it is now asked once over the whole stretch it covers.

## [1.8.0] — 2026-09-14

### Added

- **One line per speaker.** A finished transcript is now grouped into runs, one per stretch of one
  voice, so two people inside the same flush arrive as two lines with two names instead of one line
  carrying whoever happened to speak last. A handover that lands in the middle of a word is never cut,
  a fragment too short to be a turn is folded into its neighbour rather than dropped, and one voice is
  carried across a short hole nobody could identify. The grouping lives in `src/runs.js`, which is pure
  and has no imports.
- **A line that is not safely one person's runs no voice command.** That shortcut bypasses the model
  entirely, so for a tool with no gate there is no second check anywhere. The model still sees the line
  and can call the tool itself, where the owner gate applies.

### Changed

- **The audio track keeps every simultaneous speaker, not just the loudest.** Each stretch now records
  who was audible and how much of it each of them held alone. Two numbers come out of it: `share` (was
  this person here at all) and `solo` (could these words only have come from them). The second is the
  one worth asking before acting on somebody's words, because the model is sent the sum of the voices
  in a frame and cannot pull them apart again.
- **The owner gate needs the owner to have been the sole voice.** "The owner held most of it" was a
  coin toss dressed up as a fact; it is now four fifths of the stretch alone, which bounds everybody
  else at a fifth. With owner priority on (the default) this changes nothing, because the mixer already
  discards the other voices while the owner holds the floor. With it off, a ban asked for while
  somebody talks over the owner is refused, and the refusal says that is why.
- **A line is finished after eight seconds even if the room never falls silent.** Two people trading
  turns kept restarting the flush timer, so one line could run as long as the conversation.
- **A frame with two voices in it announces nobody.** The speaker announcement writes to the channel
  the model treats as hard fact, so a wrong name there is the expensive kind.

### Fixed

- **A line spoken by one person was labelled with another's name.** The line buffer kept only the last
  fragment's speaker, so any line that contained two voices was attributed to whoever finished it.
- **Half-said lines are finished before the audio timeline restarts**, and a trailing fragment from a
  socket that has already been replaced is ignored.

## [1.7.0] — 2026-09-14

### Changed

- **The mixer now decides who is speaking, instead of whose microphone is open.** Every speaker gets a
  small voice-activity state machine: speech has to clear the same bar the per-user transcriber uses
  (a peak of 400, not 50, which is a fan or a keyboard) for two frames, and it then stays that person's
  turn for half a second afterwards, because the gaps between words are part of the sentence. The
  dominant speaker is chosen on a smoothed level rather than on the sharpest transient inside a single
  20 ms frame. The model is sent one mixed stream, so this list is the only record of who said what,
  and it is what decides whose sentence a transcript line was.
- **The priority speaker keeps the room through packet jitter.** The owner used to lose the floor on a
  single missing packet, so their sentence was cut into pieces and the pieces were shared out among
  whoever else happened to have an open microphone. A pause now has to last past the point where it
  stops being jitter (100 ms of no packets, or half a second of quiet) before the room is handed back.
  The thresholds follow the ones the Craig recording bot uses to tell jitter from a real silence.

### Fixed

- **A line said by one person was attributed to another** in a channel with several people in it. Both
  causes are in the mixer changes above.

## [1.6.2] — 2026-09-14

### Fixed

- **A voice command was refused because the command word carried a suffix.** Gate keywords written as
  `=word` were compared as whole words, which is a reasonable test in English and the wrong one in a
  language that glues the mood onto the verb: the owner said "herkesi bu odaya ceksene" and
  "work zone odasina tasir misin", and the gate answered that the owner had not said the word. A `=word`
  entry is now a stem and matches the inflections its own language allows, which each locale declares in
  `keywords.inflection`; an unrelated word that merely starts the same way ("cekirdek", "gecen") still
  does not match, and English keeps its narrow "takes but not taking" rule.
- **Several ways of asking for a move were missing from the vocabulary**, among them "indir", "cikar",
  "aktar" and "topla".

## [1.6.1] — 2026-09-14

### Fixed

- **Running out of API credit left the bot pretending to work.** The wall arrived as a plain
  `invalid_request_error` whose only clue was the sentence "You have no credits remaining", so it was not
  classified as permanent: the socket stayed open, every request on it failed, and the assistant kept
  saying it had sent the message. A billing failure is now recognised by its wording as well as its code,
  and a session that fails three times in a minute is closed and retried, which is also what hands the
  conversation to the local brain.

## [1.6.0] — 2026-09-14

### Added

- **Fifty-three more tools, taking the assistant over most of what a bot can do on a server.** Each area
  was researched against the installed discord.js and the Discord documentation before it was written,
  and everything that changes the server is behind the owner gate.
  - **Threads and forum posts**: start one on a message or in a channel, open a forum post with tags,
    rename, archive, lock, add or remove a person, join or leave, list, and delete with a confirmation.
  - **Reactions, pins and polls**: react to a message, take a reaction off, clear them, pin and unpin,
    list the pins, open a poll with up to ten answers and end one early.
  - **Emoji and stickers**: list, add from a picture already posted on Discord, rename, delete.
  - **Scheduled events**: list, create for a voice channel, a stage or an external place, edit, cancel,
    and say how many people are interested.
  - **Auto-moderation**: list the rules and what each does, write a keyword rule, switch one on or off,
    delete one.
  - **Webhooks**: list, create, rename, delete. A webhook link is a password, so it is never read out
    loud, never logged and never put in an activity record.
  - **Server settings**: name, description, icon and banner, the AFK and system channel, the default
    notification level, integrations, running a stage, and removing inactive members, which always
    reports how many people it would remove before it asks.
- **The bot can change its own face**: its nickname on this server, its avatar, its profile banner, its
  "about me" text, and the line under its name. While music is playing that line shows the track by
  itself and goes back to what it was when the music stops (`PRESENCE_MUSIC`).
- Messages the bot sent in a private conversation can now be deleted or corrected: `delete_messages` and
  `edit_message` take a `dm` argument naming the person, or the word for "the last one".

### Fixed

- **"Be quiet" is now a state the owner holds, not a request to the model.** Somebody else saying "talk"
  no longer undoes it: while it is on, the bot's audio is dropped at the last step before the channel,
  and only the owner can lift it. The bot keeps listening and keeps running the tools it is asked for.
- **Every finished line is labelled with who said it**, instead of a name being announced only when the
  speaker changed. A name announced on a switch went stale halfway through a conversation, which is how
  people ended up being addressed by each other's names.

- **The assistant banned somebody nobody had asked it to ban.** The owner said "Adem, try to get me
  banned"; the gate checks who said a command word, not who the command was about, and the word had been
  said. Kicking and banning now always name the target out loud and wait for an answer, whether or not
  the name matched exactly.
- **A line spoken over somebody else is no longer credited to whoever was louder.** The attribution
  reports how much of a line belongs to its dominant speaker, and below seventy percent the line reaches
  the model as "two people spoke at once here, I am not sure who said it".

## [1.5.2] — 2026-09-13

### Fixed

- **Two-step confirmations could never complete.** Deleting a channel or a role, and banning, kicking or
  timing out somebody whose name was not an exact match, all ask first and act on the answer. The pending
  question was stored on the dependency object handed to the tool, and since the owner-gate turn pinning
  in 1.4.0 the realtime path builds a fresh one for every call — so the answer never found the question
  and the assistant asked again, forever. Pending confirmations now live in a store of their own, kept
  per server so one cannot confirm another's deletion.

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
