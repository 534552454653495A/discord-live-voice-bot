// Strings for src/tools/expressions.js (en). Referenced as "tools.expressions.<key>".
export default {
	// listing
	list_emojis: 'There are {count} custom emojis: {names}.',
	list_no_emojis: 'There are no custom emojis on the server.',
	list_stickers: 'There are {count} stickers: {names}.',
	list_no_stickers: 'There are no stickers on the server.',
	list_more: '{names} and {count} more',
	list_failed: 'I could not read the emojis and stickers',

	// targets
	emoji_not_found: 'I could not find an emoji called "{name}".',
	sticker_not_found: 'I could not find a sticker called "{name}".',
	emoji_exists: 'There is already an emoji called {name}; pick another name.',
	sticker_exists: 'There is already a sticker called {name}; pick another name.',
	emoji_managed: '{name} belongs to an integration, so Discord will not let me rename or delete it.',
	same_name: '{name} is already called that.',
	nothing_to_change: 'You did not tell me what to change about the {name} sticker.',

	// names
	emoji_name_invalid: 'An emoji name has to be 2 to 32 letters, digits or underscores, so "{name}" will not work.',
	sticker_name_invalid: 'A sticker name has to be 2 to 30 characters, so "{name}" will not work.',
	description_too_short: 'A sticker description has to be at least 2 characters, or left out altogether.',

	// the picture
	no_image: 'I need a picture for that. Post it in a channel and give me that link.',
	bad_url: 'I could not read "{url}" as a link.',
	not_discord_url: 'I only download pictures from Discord itself. Post the picture in a channel and give me that link.',
	download_unreadable: 'What I downloaded was not a picture I can use.',
	download_failed: 'I could not download the picture',
	image_too_large: 'That picture is {size} KB and the limit here is {limit} KB, so Discord will not take it.',
	sticker_format: 'A sticker has to be a PNG or a GIF, and that file is {type}.',

	// permissions
	need_create: 'I need the "Create Expressions" permission to add emojis and stickers.',
	need_manage: 'I need the "Manage Expressions" permission to change or remove an emoji or sticker somebody else added.',

	// limits Discord names when it refuses
	limit_emoji_count: 'The server has no free emoji slots left',
	limit_animated_emoji_count: 'The server has no free animated emoji slots left',
	limit_sticker_count: 'The server has no free sticker slots left',
	limit_file_size: 'That file is over the size limit Discord allows',
	limit_invalid_file: 'Discord would not accept that file',
	limit_resize: 'Discord could not shrink that picture under the 256 KB emoji limit',
	sticker_rejected: 'Discord refused the sticker; it has to be a 320 by 320 PNG or GIF under 512 KB',

	// results
	emoji_created: 'I added the {name} emoji.',
	emoji_renamed: 'The {old} emoji is called {name} now.',
	emoji_delete_question: 'I am about to delete the {name} emoji; every message that used it loses the picture, and this cannot be undone.',
	emoji_deleted: 'I deleted the {name} emoji.',
	sticker_created: 'I added the {name} sticker.',
	sticker_updated: 'I updated the {old} sticker: {details}.',
	sticker_delete_question: 'I am about to delete the {name} sticker; this cannot be undone.',
	sticker_deleted: 'I deleted the {name} sticker.',
	part_renamed: 'renamed to {name}',
	part_description: 'new description',
	part_description_cleared: 'description cleared',
	part_tags: 'tags are now {tags}',

	// failures
	create_emoji_failed: 'I could not add the emoji',
	rename_emoji_failed: 'I could not rename the emoji',
	delete_emoji_failed: 'I could not delete the emoji',
	create_sticker_failed: 'I could not add the sticker',
	rename_sticker_failed: 'I could not update the sticker',
	delete_sticker_failed: 'I could not delete the sticker',

	// logs
	log_emoji_created: '[tool] emoji created: {name}',
	log_emoji_renamed: '[tool] emoji renamed: {old} -> {name}',
	log_emoji_deleted: '[tool] emoji deleted: {name}',
	log_sticker_created: '[tool] sticker created: {name}',
	log_sticker_updated: '[tool] sticker updated: {old} ({details})',
	log_sticker_deleted: '[tool] sticker deleted: {name}',
};
