// Strings for src/tools/events.js (en). Referenced as "tools.events.<key>".
//
// The *_words / *_names lists are spoken VOCABULARY, not output: the time parser normalises them (accents
// folded, punctuation dropped) before matching, so they can be written here the natural way. A list may
// grow or shrink per language; the message keys above them may not.
export default {
	// Time vocabulary. "in 2 hours", "tomorrow at 21:00", "friday 9 pm".
	unit_minute_words: ['minute', 'minutes', 'min', 'mins'],
	unit_hour_words: ['hour', 'hours', 'hr', 'hrs'],
	unit_day_words: ['day', 'days'],
	unit_week_words: ['week', 'weeks'],
	one_words: ['a', 'an', 'one'],
	at_words: ['at', 'around'],
	today_words: ['today', 'tonight', 'this evening', 'this afternoon'],
	tomorrow_words: ['tomorrow'],
	day_after_words: ['day after tomorrow'],
	// One list per weekday, starting at Sunday (the order Date#getDay uses).
	weekday_names: [
		['sunday', 'sun'],
		['monday', 'mon'],
		['tuesday', 'tue', 'tues'],
		['wednesday', 'wed'],
		['thursday', 'thu', 'thur', 'thurs'],
		['friday', 'fri'],
		['saturday', 'sat'],
	],

	// Time refusals: the hour is never invented, it is asked for.
	time_missing: 'You did not tell me when the event starts.',
	time_unreadable: 'I could not work out a time from "{text}". Say it like "in 2 hours", "tomorrow at 21:00", or give me a full date.',
	time_needs_clock: 'I got the day from "{text}" but not the hour. At what time?',
	end_unreadable: 'I could not work out an end time from "{text}". Say it like "23:00" or "2 hours" for how long it lasts.',
	end_needs_clock: 'I got the day the event ends from "{text}" but not the hour. At what time does it finish?',
	time_in_past: '{when} has already passed; an event has to start in the future.',
	end_before_start: 'The event cannot end before it starts.',
	end_missing: 'An event held outside Discord also needs an end time. When does it finish?',
	when_unknown: 'at an unknown time',

	// Where an event happens.
	where_channel: 'in {channel}',
	where_location: 'at {location}',
	where_unknown: 'somewhere I cannot see',

	// Lookup.
	unavailable: 'I cannot reach the scheduled events on this server.',
	which_event: 'Which event do you mean?',
	event_not_found: 'I could not find an event called "{name}".',
	lookup_failed: 'I could not read the events',

	// Permissions.
	no_create_permission: 'I need the "Create Events" permission to do that; give it to my role and I will.',
	no_manage_permission: 'That event was made by somebody else, so I need the "Manage Events" permission to touch it.',
	no_channel_access: 'I cannot hold an event in {channel}: I need "View Channel" and "Connect" there.',

	// Listing.
	no_events: 'There are no events coming up.',
	list_entry: '{name}, {when}, {where}, {interested} interested',
	events_list: 'Events coming up: {events}.',

	// Creating.
	name_missing: 'What should the event be called?',
	which_place: 'Which voice channel is the event in? If it is not on Discord at all, tell me the place instead.',
	channel_not_found: 'I could not find the "{name}" channel.',
	not_a_voice_channel: '"{name}" is not a voice or a stage channel, and an event can only be held in one of those.',
	not_a_stage: '"{name}" is an ordinary voice channel, not a stage channel.',
	location_missing: 'An event outside Discord needs a place. Where is it happening?',
	created: 'I scheduled "{name}" for {when}, {where}.',
	create_failed: 'I could not create the event',
	log_created: '[tool] scheduled event created: {name} ({when})',

	// Editing.
	nothing_to_change: 'You did not tell me what to change about the event.',
	event_over: '"{name}" is already over, so there is nothing left to change.',
	external_has_no_channel: '"{name}" happens outside Discord, so it has no channel. Create a new event for a voice channel.',
	not_an_external_event: '"{name}" is held in a channel, so it has no location to set. Give me a channel instead.',
	part_renamed: 'renamed to "{name}"',
	part_description: 'new description',
	part_start: 'starts {when}',
	part_end: 'ends {when}',
	part_channel: 'moved to {channel}',
	part_location: 'now at {location}',
	edited: 'I updated "{name}": {details}.',
	edit_failed: 'I could not update the event',
	log_edited: '[tool] scheduled event edited: {name} ({details})',

	// Cancelling.
	cancel_question: 'I am about to cancel "{name}", the one on {when}; that cannot be undone.',
	already_cancelled: '"{name}" is already cancelled.',
	already_finished: '"{name}" has already finished.',
	cancelled: 'I cancelled "{name}".',
	ended: '"{name}" had already started, so I ended it instead of cancelling it.',
	cancel_failed: 'I could not cancel the event',
	log_cancelled: '[tool] scheduled event cancelled: {name}',
	log_ended: '[tool] scheduled event ended: {name}',

	// Interest.
	interest: '"{name}" has {count} interested, among them {names}.',
	interest_count: '"{name}" has {count} interested so far.',
	interest_none: 'Nobody has marked themselves interested in "{name}" yet.',
	interest_failed: 'I could not read who is interested',
	log_subscribers_failed: '[tool] interested-list unavailable: {error}',
};
