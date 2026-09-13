// Strings for src/tools/automod.js (en). Referenced as "tools.automod.<key>".
export default {
	unavailable: 'I cannot reach the auto-moderation rules on this server.',
	no_manage_guild: 'I need the "Manage Server" permission to touch the auto-moderation rules; give it to my role and I will do it.',
	no_moderate_members: 'I need the "Moderate Members" permission to put a timeout in a rule. Without it I can still build the rule if you drop the timeout.',

	// what a rule looks for
	trigger_keyword: 'looks for {count} blocked words ({words})',
	trigger_keyword_one: 'looks for one blocked word ({words})',
	trigger_regex: 'matches {count} regex patterns',
	trigger_regex_one: 'matches one regex pattern',
	trigger_empty: 'has no words in it yet',
	trigger_spam: 'catches generic spam',
	trigger_preset: "uses Discord's own word lists ({presets})",
	trigger_mention_spam: 'catches messages with more than {limit} mentions',
	trigger_member_profile: 'looks for {words} in member profiles',
	trigger_unknown: 'uses a filter I do not recognise',
	preset_profanity: 'swearing',
	preset_sexual: 'sexual content',
	preset_slurs: 'slurs',
	and_more: 'and {more} more',

	// what it does when it fires
	action_block: 'blocks the message',
	action_alert: 'reports it in #{channel}',
	action_alert_unknown: 'reports it in a channel I cannot see',
	action_timeout: 'times the person out for {minutes} minutes',
	action_timeout_one: 'times the person out for a minute',
	action_block_interaction: 'stops the person writing or joining voice',
	action_none: 'does nothing',
	exempt_suffix: '; it skips {targets}',
	exempt_suffix_unknown: '; some roles or channels are left out of it',
	effect: 'it {trigger}, then it {actions}{exempt}',
	state_on: 'on',
	state_off: 'off',

	// listing
	no_rules: 'There are no auto-moderation rules on this server.',
	list: '{count} auto-moderation rules. {rules}.',
	list_one: 'There is one auto-moderation rule. {rules}.',
	rule_line: '{rule} ({state}) — {effect}',
	list_failed: 'I could not read the auto-moderation rules',

	// creating
	default_name: 'voice filter',
	no_keywords: 'Which words should the rule block? I need at least one word of {min} letters or more.',
	keyword_too_short: 'I will not build a filter on "{words}" — anything shorter than {min} letters matches inside almost every message and would silence the whole server.',
	keyword_too_long: 'These are longer than the {limit} characters Discord allows in a filter word: {words}.',
	too_many_rules: 'This server already has the {limit} keyword rules Discord allows. Delete one and I will add this.',
	name_taken: 'There is already a rule called "{name}". Give this one a different name so we can tell them apart.',
	alert_channel_not_found: 'I could not find a channel called "{name}" to send the alerts to.',
	alert_channel_not_text: '#{channel} is not a text channel, so the alerts cannot go there.',
	exempt_role_not_found: 'I could not find a role called "{name}" to leave out of the rule.',
	exempt_channel_not_found: 'I could not find a channel called "{name}" to leave out of the rule.',
	created: 'The {rule} rule is ready and it is {state}: {effect}.',
	create_failed: 'I could not create the auto-moderation rule',
	log_created: '[tool] automod rule created: {rule} ({count} words)',

	// switching on and off
	rule_not_found: 'I could not find an auto-moderation rule called "{name}".',
	already_on: 'The {rule} rule is already on.',
	already_off: 'The {rule} rule is already off, so it is not blocking anything.',
	turned_on: 'The {rule} rule is on now: {effect}.',
	turned_off: 'The {rule} rule is off now; it blocks nothing until you switch it back on.',
	toggle_failed: 'I could not switch the rule',
	log_toggled: '[tool] automod rule switched {state}: {rule}',

	// changing the words
	not_keyword_rule: 'The {rule} rule does not work from a word list ({trigger}), so there are no words to change.',
	nothing_to_update: 'Tell me which words to add or to take out.',
	would_be_empty: 'That would leave the {rule} rule with no words at all. If you want it gone, delete the rule.',
	words_unchanged: 'The {rule} rule already watches exactly those words.',
	updated: 'The {rule} rule now watches {count} words: {words}. It is {state}.',
	updated_one: 'The {rule} rule now watches one word: {words}. It is {state}.',
	update_failed: 'I could not change the words on the rule',
	log_updated: '[tool] automod keywords updated: {rule} ({count} words)',

	// deleting
	delete_question: 'I am about to delete the {rule} rule for good; right now {effect}.',
	deleted: 'I deleted the {rule} rule; whatever it was blocking is allowed again.',
	delete_failed: 'I could not delete the rule',
	log_deleted: '[tool] automod rule deleted: {rule}',
};
