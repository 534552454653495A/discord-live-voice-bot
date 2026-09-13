// Locale bundle: en. Each namespace mirrors a source module group.
import boot from './boot.js';
import runtime from './runtime.js';
import voice from './voice.js';
import live from './live.js';
import brain from './brain.js';
import music from './music.js';
import messages from './messages.js';
import panel from './panel.js';
import commands from './commands.js';
import store from './store.js';
import memory from './memory.js';
import quota from './quota.js';
import summary from './summary.js';
import auth from './auth.js';
import provider from './provider.js';
import agent from './agent.js';
import config from './config.js';
import reader from './reader.js';
import keywords from './keywords.js';
import grammar from './grammar.js';
import toolsHelpers from './tools-helpers.js';
import toolsMessaging from './tools-messaging.js';
import toolsMembers from './tools-members.js';
import toolsModeration from './tools-moderation.js';
import toolsChannels from './tools-channels.js';
import toolsRoles from './tools-roles.js';
import toolsSession from './tools-session.js';
import toolsMusic from './tools-music.js';
import toolsMemory from './tools-memory.js';
import toolsSummary from './tools-summary.js';

export default {
	boot,
	runtime,
	voice,
	live,
	brain,
	music,
	messages,
	panel,
	commands,
	store,
	memory,
	quota,
	summary,
	auth,
	provider,
	agent,
	config,
	reader,
	keywords,
	grammar,
	tools: {
		helpers: toolsHelpers,
		messaging: toolsMessaging,
		members: toolsMembers,
		moderation: toolsModeration,
		channels: toolsChannels,
		roles: toolsRoles,
		session: toolsSession,
		music: toolsMusic,
		memory: toolsMemory,
		summary: toolsSummary,
	},
};
