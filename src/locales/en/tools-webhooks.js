// Strings for src/tools/webhooks.js (en). Referenced as "tools.webhooks.<key>".
// A webhook address is a credential: only dm_body may carry one, and it is sent to the owner in a
// direct message. No other string here takes a {url} placeholder.
export default {
	// resolving the channel and the webhook
	channel_unknown: 'a channel I cannot see',
	creator_unknown: 'someone I cannot see',
	which_channel: 'Which channel should the webhook go in?',
	channel_not_found: 'I could not find the "{name}" channel.',
	not_webhook_channel: '"{name}" cannot hold a webhook; only text, announcement, forum, media and voice channels can.',
	no_permission_channel: 'I need the "Manage Webhooks" permission in #{channel}; give it to my role and I will do it.',
	no_permission: 'I need the "Manage Webhooks" permission on this server; give it to my role and I will do it.',
	which_webhook: 'Which webhook do you mean?',
	not_found: 'I could not find a webhook called "{name}".',
	not_found_in_channel: 'There is no webhook called "{name}" in #{channel}.',
	ambiguous_entry: '{name} in #{channel}',
	ambiguous: 'More than one webhook matches "{name}": {list}. Tell me the channel as well, or give me the exact name.',

	// names
	no_name: 'What should the webhook be called?',
	name_too_long: 'A webhook name can be at most {limit} characters long.',
	name_reserved: 'Discord does not allow "discord" or "clyde" inside a webhook name.',

	// listing
	list_failed: 'I could not read the webhooks',
	none: 'There are no webhooks on this server.',
	none_in_channel: 'There are no webhooks in #{channel}.',
	entry_channel: '{name} (created by {creator})',
	entry_server: '{name} in #{channel} (created by {creator})',
	and_more: 'and {count} more',
	list_channel: 'The webhooks in #{channel}: {list}.',
	list_server: 'The webhooks on the server: {list}.',
	log_listed_channel: '[tool] webhooks listed in #{channel}: {count}',
	log_listed_server: '[tool] webhooks listed on the server: {count}',

	// creating
	channel_full: 'A channel can hold at most {limit} webhooks and #{channel} is full; delete one first.',
	created: 'I created the "{name}" webhook in #{channel}. I am not reading its address out loud; ask me for it and it goes to you in a direct message.',
	create_failed: 'I could not create the webhook',
	log_created: '[tool] webhook created: {name} in #{channel}',

	// renaming
	same_name: 'That webhook is already called "{name}".',
	renamed: 'I renamed the "{old}" webhook to "{name}".',
	rename_failed: 'I could not rename the webhook',
	log_renamed: '[tool] webhook renamed: {old} -> {name}',

	// deleting
	delete_question: 'I am about to delete the "{webhook}" webhook in #{channel}; whatever posts through it stops working and it cannot be brought back.',
	deleted: 'I deleted the "{webhook}" webhook in #{channel}.',
	delete_failed: 'I could not delete the webhook',
	log_deleted: '[tool] webhook deleted: {webhook} in #{channel}',

	// the address, owner only, by direct message
	url_unavailable: 'I cannot get an address for "{webhook}": Discord only hands me the token of the webhooks I manage myself, and this one belongs to another app or follows another channel.',
	no_owner: 'No bot owner is set, so I have nobody to send the address to, and I am not saying it out loud.',
	owner_not_found: 'I could not find the owner on this server, so I cannot send the address, and I am not saying it out loud.',
	dm_body: 'The address of the "{webhook}" webhook in #{channel}: {url} — anyone holding this link can post as that webhook, so keep it to yourself.',
	url_sent: 'I sent the address of "{webhook}" to you in a direct message; I am not saying it out loud.',
	url_failed: 'I could not send the address in a direct message, and I am not saying it out loud',
	log_url_sent: '[tool] webhook address sent to the owner by DM: {webhook}',
};
