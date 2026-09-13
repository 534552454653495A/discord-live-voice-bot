// Role hierarchy diagnosis (read-only): compares the position of the bot's highest role with the target role's.
import { Client, GatewayIntentBits } from 'discord.js';
import { loadConfig } from '../src/config.js';

const cfg = loadConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
await client.login(cfg.discordToken);
await new Promise((resolve) => client.once('clientReady', resolve));
const guild = await client.guilds.fetch(cfg.guildId);
await guild.roles.fetch();

const me = guild.members.me ?? (await guild.members.fetch(client.user.id));
const highest = me.roles.highest;
console.log('bot:', client.user.username, '| permissions: ManageRoles =', me.permissions.has('ManageRoles'));
console.log('highest role of the bot:', highest.name, '| position:', highest.position);
console.log(
	'roles of the bot:',
	[...me.roles.cache.values()].map((r) => `${r.name}(${r.position})`).join(', '),
);

const targets = process.argv.slice(2);
const names = targets.length ? targets : ['Moderator', 'roleplay'];
const all = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);
for (const name of names) {
	// Turkish-aware lower-casing (dotted/dotless i) is kept on purpose so role names written in Turkish still match.
	const needle = name.toLocaleLowerCase('tr');
	const role = all.find((r) => r.name.toLocaleLowerCase('tr') === needle) ?? all.find((r) => r.name.toLocaleLowerCase('tr').includes(needle));
	if (!role) {
		console.log(`"${name}": NOT FOUND`);
		continue;
	}
	const above = role.position >= highest.position;
	console.log(
		`"${role.name}": position ${role.position} | managed ${role.managed} | above the bot: ${above ? 'YES (cannot grant)' : 'no (can grant)'}`,
	);
}
console.log('--- role positions (highest to lowest, first 20) ---');
for (const role of all.slice(0, 20)) console.log(`${String(role.position).padStart(3)} ${role.name}`);
await client.destroy();
