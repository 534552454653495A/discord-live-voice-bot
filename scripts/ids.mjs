// Setup helper: lists the servers the bot can reach and their voice channels.
//
//   npm run ids        (or: node --env-file=.env scripts/ids.mjs)
//
// Shows whether the GUILD_ID / CHANNEL_ID values in .env are correct.

import { Client, Events, GatewayIntentBits, PermissionsBitField } from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
	console.log(`Logged in: ${client.user.tag}\n`);
	try {
		const guilds = await client.guilds.fetch();
		if (guilds.size === 0) {
			console.log('The bot is not in any server. You need to invite it to one.');
		}
		console.log('Servers the bot is in:');
		for (const [, partial] of guilds) {
			const guild = await partial.fetch();
			const marker = guild.id === process.env.GUILD_ID ? '  <-- .env GUILD_ID' : '';
			console.log(`  ${guild.id}  ${guild.name}${marker}`);
			const channels = await guild.channels.fetch();
			for (const [, channel] of channels) {
				if (!channel || !channel.isVoiceBased()) continue;
				const cMarker = channel.id === process.env.CHANNEL_ID ? '  <-- .env CHANNEL_ID' : '';
				console.log(`      voice: ${channel.id}  ${channel.name}${cMarker}`);
			}
		}
		const configuredGuild = guilds.get(process.env.GUILD_ID ?? '');
		if (!configuredGuild) console.log('\nWARNING: .env GUILD_ID is not reachable for this bot.');

		const target = await client.channels.fetch(process.env.CHANNEL_ID ?? '').catch(() => null);
		if (!target) {
			console.log('\nWARNING: .env CHANNEL_ID was not found.');
		} else {
			const me = target.guild.members.me ?? (await target.guild.members.fetch(client.user.id));
			const perms = target.permissionsFor(me);
			const flags = PermissionsBitField.Flags;
			console.log(`\nTarget channel: "${target.name}"  type=${target.type} (2=voice, 13=stage)`);
			for (const [label, flag] of [
				['ViewChannel', flags.ViewChannel],
				['Connect', flags.Connect],
				['Speak', flags.Speak],
				['UseVAD', flags.UseVAD],
			]) {
				console.log(`  ${label}: ${perms.has(flag) ? 'yes' : 'NO'}`);
			}
			const current = me.voice?.channelId ?? null;
			console.log(`  bot right now: ${current ? `in a voice channel (${current})` : 'not in a voice channel'}`);
		}

		try {
			const commands = await client.application.commands.fetch({ guildId: process.env.GUILD_ID });
			console.log(
				`\nRegistered slash commands (${commands.size}): ${commands.size ? commands.map((c) => `/${c.name}`).join(' ') : 'none'}`,
			);
		} catch (err) {
			console.log(`\nCould not read slash commands: ${err.message}`);
		}
	} catch (err) {
		console.error('Listing failed:', err.message);
		process.exitCode = 1;
	}
	client.destroy();
});

client.on('error', (err) => console.error('Discord error:', err.message));
client.login(process.env.DISCORD_TOKEN).catch((err) => {
	console.error('Login failed:', err.message);
	process.exitCode = 1;
	client.destroy();
});
