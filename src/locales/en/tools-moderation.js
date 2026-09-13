// Strings for src/tools/moderation.js (en). Referenced as "tools.moderation.<key>".
export default {
	confirm_question: 'I am about to {action} {who}. Say that you confirm and I will do it.',
	fuzzy_question: 'I could not match the name "{name}" exactly; the closest person is {who}. Should the {action} go to them?',
	action_timeout: 'timeout',
	action_kick: 'kick',
	action_ban: 'ban',

	member_not_found: 'I could not find anyone called "{name}".',
	that_person: 'That person',

	no_timeout_permission: 'I do not have enough power over {who} (role hierarchy).',
	log_timeout: '[tool] timeout: {who} ({minutes} min)',
	timeout_done: 'I gave {who} a {minutes} minute timeout.',
	timeout_failed: 'I could not apply the timeout',

	log_untimeout: '[tool] timeout removed: {who}',
	untimeout_done: 'I removed the timeout on {who}.',
	untimeout_failed: 'I could not remove the timeout',

	no_kick_permission: 'I do not have enough power to kick {who} (role hierarchy).',
	log_kick: '[tool] kick: {who}',
	kick_done: 'I kicked {who} from the server.',
	kick_failed: 'I could not kick them',

	no_ban_permission: 'I do not have enough power to ban {who}.',
	log_ban: '[tool] ban: {who}',
	ban_done: 'I banned {who}.',
	ban_failed: 'I could not ban them',

	log_ban_list: '[tool] ban list: {count} people',
	ban_list: 'There are {count} people on the ban list: {names}{more}.',
	ban_list_empty: 'The ban list is empty.',
	ban_list_failed: 'I could not see the ban list',

	no_unban_target: 'I could not work out whose ban to lift.',
	unban_not_found: 'I could not find anyone called "{name}" on the ban list.',
	log_unban: '[tool] ban lifted: {who}',
	unban_done: 'I lifted the ban on {who}.',
	unban_failed: 'I could not lift the ban',

	log_audit: '[tool] audit log read: {count} entries',
	audit_summary: 'The last {count} moderator actions — most recent: {executor} {action}{target}.',
	audit_empty: 'The audit log looks empty.',
	audit_failed: 'I could not see the audit log',
};
