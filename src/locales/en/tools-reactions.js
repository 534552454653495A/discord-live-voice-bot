// Strings for src/tools/reactions.js (en). Referenced as "tools.reactions.<key>".
export default {
	// shared: target channel, target message, emoji
	channel_not_found: 'I could not find the "{name}" channel.',
	no_channel: 'Which channel is that message in?',
	not_text_channel: 'There are no messages in #{channel} — that is not a text channel.',
	message_id_not_found: 'There is no message with the id {id} in #{channel}.',
	message_not_found: 'I could not find a message like that in #{channel}.',
	read_failed: 'I could not read the messages in #{channel}.',
	which_emoji: 'Which emoji should I use?',
	emoji_not_found: 'There is no emoji called "{name}" on this server.',
	member_not_found: 'I could not find anyone called "{name}".',
	empty_message: '(no text)',

	// add_reaction
	no_add_reactions: 'I need the "Add Reactions" permission in #{channel} to react there.',
	reacted: 'I reacted to {who}\'s message with {emoji}.',
	react_failed: 'I could not add that reaction',
	log_reacted: '[tool] reaction added: {emoji} in #{channel}',

	// remove_reaction
	need_manage_messages: 'I need the "Manage Messages" permission in #{channel}; that is what lets me take other people\'s reactions off.',
	no_such_reaction: 'There is no {emoji} reaction on that message.',
	not_my_reaction: 'I have not reacted to that message with {emoji}.',
	removed_own: 'I took my {emoji} reaction back.',
	removed_other: 'I removed {who}\'s {emoji} reaction.',
	remove_failed: 'I could not remove that reaction',
	log_removed_own: '[tool] own reaction removed: {emoji} in #{channel}',
	log_removed_other: '[tool] reaction removed: {emoji} of {who} in #{channel}',

	// clear_reactions
	no_reactions: 'There are no reactions on that message.',
	everything: 'every reaction',
	clear_question_all: 'I am about to wipe every reaction off that message in #{channel}; the people who reacted will not be asked again.',
	clear_question_emoji: 'I am about to remove every {emoji} reaction from that message in #{channel}.',
	cleared_all: 'I cleared every reaction off that message ({count} in total).',
	cleared_emoji: 'I removed {count} {emoji} reactions from that message.',
	clear_failed: 'I could not clear the reactions',
	log_cleared: '[tool] reactions cleared: {what} in #{channel}',

	// pin_message
	need_pin_messages: 'I need the "Pin Messages" permission in #{channel} to pin or unpin anything.',
	already_pinned: 'That message is already pinned in #{channel}.',
	not_pinned: 'That message is not pinned, so there is nothing to unpin.',
	pinned: 'I pinned {who}\'s message in #{channel}.',
	unpinned: 'I unpinned {who}\'s message in #{channel}.',
	pin_failed: 'I could not pin the message',
	unpin_failed: 'I could not unpin the message',
	log_pinned: '[tool] message pinned in #{channel} (from {who})',
	log_unpinned: '[tool] message unpinned in #{channel} (from {who})',

	// list_pins
	need_read_history: 'I need the "Read Message History" permission in #{channel} to see what is pinned there.',
	no_pins: 'Nothing is pinned in #{channel}.',
	pins_list: '{count} pinned messages in #{channel}: {items}.',
	pins_more: 'There are older pins as well.',
	pin_item: '{who}: {text}',
	pins_failed: 'I could not read the pinned messages in #{channel}',
	log_pins: '[tool] pins listed: {count} in #{channel}',

	// create_poll
	no_question: 'What should the poll ask?',
	too_few_answers: 'A poll needs at least two answers; give me a couple of options.',
	too_many_answers: 'a poll can hold at most ten answers, so I left the extra ones out',
	need_send_polls: 'I need the "Send Polls" permission in #{channel} to open a poll there.',
	poll_created: 'I opened the poll in #{channel}: {question} — {answers}. It stays open for {hours} hours.',
	poll_failed: 'I could not open the poll',
	log_poll: '[tool] poll opened in #{channel}: {question} ({answers} answers, {hours} h)',

	// end_poll
	not_a_poll: 'That message is not a poll.',
	poll_not_mine: 'Discord only lets the author end a poll, and that one is {who}\'s.',
	poll_already_ended: 'That poll has already finished.',
	poll_ended: 'I closed the poll. The result: {results}.',
	poll_result_item: '{answer}: {votes}',
	no_votes: 'nobody voted',
	end_failed: 'I could not end the poll',
	log_poll_ended: '[tool] poll ended in #{channel}',
};
