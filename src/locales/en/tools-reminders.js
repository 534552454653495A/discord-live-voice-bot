// Reminder strings (en). Keys are referenced as "tools.reminders.<key>".
export default {
	disabled: 'Reminders are not available right now.',
	empty: 'I need something to say when the time comes.',
	bad_time: 'Tell me when: a number of minutes, or a clock time such as 21:30.',
	full: 'This server already has {max} reminders waiting; cancel one of them first.',
	set: 'All right, at {when} I will say: {text}',
	list_empty: 'No reminders are waiting here.',
	list: '{count} reminders are waiting: {lines}',
	needle_empty: 'Which reminder should I cancel?',
	not_found: 'I could not find a reminder of yours about "{text}".',
	cancelled: 'Cancelled: {text}',
	log_set: '[reminder] {when}: {text}',
	log_cancel: '[reminder] cancelled: {text}',
	activity_set: 'reminder set for {when}: {text}',
};
