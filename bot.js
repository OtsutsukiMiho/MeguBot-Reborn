require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client, ActivityType, Collection, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildInvites,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.DirectMessageReactions,
		GatewayIntentBits.MessageContent,
	],
});

const { BotLogs, COLOR: COLOR } = require('./bot_functions.js');
const database = require('./database.js');

client.honeypots = new Map();

function autoJoinActiveVC(guild) {
	const voiceChannels = guild.channels.cache.filter(channel => channel.type === 2);
	for (const [, voiceChannel] of voiceChannels) {
		if (guild.afkChannelId && voiceChannel.id === guild.afkChannelId) continue;
		if (voiceChannel.members.size >= 1 && !(voiceChannel.members.size === 1 && voiceChannel.members.has(guild.members.me.id))) {
			try {
				joinVoiceChannel({
					channelId: voiceChannel.id,
					guildId: guild.id,
					adapterCreator: guild.voiceAdapterCreator,
				});
				BotLogs(guild.name, `${COLOR.blue}Joining Active VC ${COLOR.gray}[${COLOR.white}${voiceChannel.name}${COLOR.gray}]`);
				return true;
			}
			catch (error) {
				BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
				BotLogs('SYSTEM', `${COLOR.red}Error Occurred: ${COLOR.white}"${error.toString().replace(/^Error: /, '')}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"`);
				BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
			}
		}
	}
	return false;
}

client.once(Events.ClientReady, async (readyClient) => {
	BotLogs('SYSTEM', `${COLOR.green}---------------------------------------------------------------`);
	BotLogs('SYSTEM', `${COLOR.green}Connected to Discord!`);
	BotLogs('SYSTEM', `${COLOR.green}---------------------------------------------------------------`);

	await database.initDatabase();

	try {
		client.honeypots = await database.getAllHoneypots();
		BotLogs('SYSTEM', `${COLOR.green}Honeypot configurations successfully cached. Loaded ${client.honeypots.size} channels.`);
	}
	catch (error) {
		BotLogs('SYSTEM', `${COLOR.red}Error initializing honeypot cache: ${error.toString()}`);
	}

	for (const [, guild] of readyClient.guilds.cache) {
		const botMember = guild.members.me;
		let joined = false;

		if (botMember && botMember.voice && botMember.voice.channel) {
			const voiceChannel = botMember.voice.channel;

			if (guild.afkChannelId && voiceChannel.id === guild.afkChannelId) continue;
			if (voiceChannel.members.size > 1) {
				try {
					joinVoiceChannel({
						channelId: voiceChannel.id,
						guildId: guild.id,
						adapterCreator: guild.voiceAdapterCreator,
					});
					BotLogs(guild.name, `${COLOR.blue}Rejoining Previous VC ${COLOR.gray}[${COLOR.white}${voiceChannel.name}${COLOR.gray}]`);
					joined = true;
				}
				catch (error) {
					BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
					BotLogs('SYSTEM', `${COLOR.red}Error Occurred: ${COLOR.white}"${error.toString().replace(/^Error: /, '')}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"`);
					BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
				}
			}
		}

		if (!joined) {
			autoJoinActiveVC(guild);
		}
	}
});

client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);
for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			client.commands.set(command.data.name, command);
		}
		else {
			BotLogs('SYSTEM', `${COLOR.yellow}Warning: The command at ${COLOR.white}${filePath}${COLOR.yellow} is missing a required "data" or "execute" property.`);
		}
	}
}

client.on(Events.InteractionCreate, async (interaction) => {

	if (interaction.isChatInputCommand()) {
		const command = interaction.client.commands.get(interaction.commandName);
		if (!command) return;

		try {
			await command.execute(interaction);
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
			BotLogs('SYSTEM', `${COLOR.red}Error Occurred: ${COLOR.white}"${error.toString().replace(/^Error: /, '')}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"`);
			BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
			}
			else {
				await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
			}
		}
	}

	else if (interaction.isAutocomplete()) {
		const command = interaction.client.commands.get(interaction.commandName);
		if (!command) return;

		try {
			await command.autocomplete(interaction);
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
			BotLogs('SYSTEM', `${COLOR.red}Error Occurred: ${COLOR.white}"${error.toString().replace(/^Error: /, '')}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"`);
			BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
		}
	}

});

client.on(Events.ClientReady, async () => {
	setInterval(async () => {
		try {
			const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
			client.user.setPresence({
				status: 'online',
				activities: [{
					name: `MeguBot Reborn | V ${config.version}`,
					type: ActivityType.Custom,
				}],
			});
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
			BotLogs('SYSTEM', `${COLOR.red}Error Occurred: ${COLOR.white}"${error.toString().replace(/^Error: /, '')}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"`);
			BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
		}
	}, 5000);

	try {
		const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
		if (config.online_ping) {
			const channelId = '1225208114941399110';

			client.channels.fetch(channelId).then(async channel => {
				const fetched = await channel.messages.fetch({ limit: 10 });
				await channel.bulkDelete(fetched).catch(console.error);

				const statusMessage = await channel.send('🟢 **MeguBot is Online!**\nLast Checked: ' + new Date().toLocaleTimeString());

				const updateStatus = () => {
					const randomDelay = Math.floor(Math.random() * (9000 - 3000 + 1)) + 3000;

					setTimeout(() => {
						try {
							statusMessage.edit('🟢 **MeguBot is Online!**\nLast Checked: ' + new Date().toLocaleTimeString() + `\nPing: ${client.ws.ping}ms`)
								.catch(err => {
									BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
									BotLogs('SYSTEM', `${COLOR.red}Error Occurred: ${COLOR.white}"${err.toString().replace(/^Error: /, '')}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"`);
									BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
								});
						}
						catch (error) {
							BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
							BotLogs('SYSTEM', `${COLOR.red}Error Occurred: ${COLOR.white}"${error.toString().replace(/^Error: /, '')}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"`);
							BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
						}
						updateStatus();
					}, randomDelay);
				};

				updateStatus();
			}).catch(console.error);
		}
	}
	catch (error) {
		BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
		BotLogs('SYSTEM', `${COLOR.red}Error Occurred: ${COLOR.white}"${error.toString().replace(/^Error: /, '')}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"`);
		BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
	}
});

const voiceStateProcessing = new Set();

async function getUserNick(guildId, userId) {
	return await database.getUserNick(guildId, userId);
}

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
	const guild = newState.guild || oldState.guild;
	const botMember = guild.members.me;

	let totalVoiceMembers = 0;
	guild.channels.cache.filter(c => c.type === 2).forEach(vc => {
		totalVoiceMembers += vc.members.size;
	});

	if (totalVoiceMembers === 0) {
		try {
			await database.deleteGuildVar(guild.id, 'old_vc_id');
		}
		catch {
			// Ignore
		}

		const { clearQueue } = require('./audio_queue.js');
		clearQueue(guild.id, guild.name);

		const connection = getVoiceConnection(guild.id);
		if (connection) {
			connection.destroy();
		}
	}

	if (newState.member.id === client.user.id && newState.channelId && oldState.channelId !== newState.channelId) {
		let oldVcId = null;
		try {
			oldVcId = await database.getGuildVar(guild.id, 'old_vc_id');
		}
		catch {
			// Ignore
		}

		if (!oldVcId) {
			await database.setGuildVar(guild.id, 'old_vc_id', newState.channelId);

			BotLogs(guild.name, `${COLOR.blue}Greeting VC ${COLOR.gray}[${COLOR.white}${newState.channel.name}${COLOR.gray}]`);

			const { addToQueue, generateUUID } = require('./audio_queue.js');

			const queue_constructor = {
				uuid: generateUUID(),
				name: 'สวัสดีชาวโลก',
				lang: 'th',
				type: 'GOOGLE_TTS',
				guild: guild,
				voice: 'th-TH-PremwadeeNeural',
				sender: client.user,
				voice_channel: newState.channel,
				connection: getVoiceConnection(guild.id),
			};
			addToQueue(guild.id, queue_constructor);
		}
		else if (oldVcId !== newState.channelId) {
			await database.setGuildVar(guild.id, 'old_vc_id', newState.channelId);
		}
	}

	if (!botMember || !botMember.voice || !botMember.voice.channel) {
		if (newState.channelId && newState.member.id !== client.user.id) {
			autoJoinActiveVC(guild);
		}
		return;
	}

	const currentChannel = botMember.voice.channel;

	if (newState.channelId === guild.afkChannelId && oldState.channelId === currentChannel.id && newState.member.id !== botMember.id) {
		newState.member.voice.setChannel(oldState.channel).catch(() => undefined);
		BotLogs(guild.name, `${COLOR.blue}Moved ${COLOR.gray}[${COLOR.white}${newState.member.user.tag}${COLOR.gray}] ${COLOR.blue}back from AFK to ${COLOR.gray}[${COLOR.white}${oldState.channel.name}${COLOR.gray}]`);
		return;
	}

	if (currentChannel.members.size === 1 && currentChannel.members.has(botMember.id)) {
		if (!voiceStateProcessing.has(guild.id)) {
			const connection = getVoiceConnection(guild.id);
			if (connection) {
				connection.destroy();
			}
			else {
				botMember.voice.setChannel(null).catch(() => undefined);
			}

			const { clearQueue } = require('./audio_queue.js');
			clearQueue(guild.id, guild.name);

			voiceStateProcessing.add(guild.id);

			setTimeout(() => {
				autoJoinActiveVC(guild);
				voiceStateProcessing.delete(guild.id);
			}, 500);
		}
	}

	if (newState.channelId === currentChannel.id && oldState.channelId !== currentChannel.id && oldState.channelId !== guild.afkChannelId && newState.member.id !== client.user.id) {
		const nick = await getUserNick(guild.id, newState.member.id);
		const { addToQueue, generateUUID } = require('./audio_queue.js');
		const queue_constructor = {
			uuid: generateUUID(),
			name: `${nick} เข้าดิสมา`,
			lang: 'th',
			type: 'GOOGLE_TTS',
			guild: guild,
			voice: 'th-TH-PremwadeeNeural',
			sender: client.user,
			voice_channel: currentChannel,
			connection: getVoiceConnection(guild.id),
		};
		BotLogs(guild.name, `${COLOR.blue}User ${COLOR.gray}[${COLOR.white}${newState.member.user.tag}${COLOR.gray}] ${COLOR.blue}joined VC ${COLOR.gray}[${COLOR.white}${newState.channel.name}${COLOR.gray}]`);
		addToQueue(guild.id, queue_constructor);
	}

	if (oldState.channelId === currentChannel.id && newState.channelId !== currentChannel.id && newState.member.id !== client.user.id) {
		const { addToQueue, generateUUID } = require('./audio_queue.js');

		if (currentChannel.members.size === 2) {
			const queue_constructor = {
				uuid: generateUUID(),
				name: 'มึงโดนเหลี่ยมแล้วว้าย',
				lang: 'th',
				type: 'GOOGLE_TTS',
				guild: guild,
				voice: 'th-TH-PremwadeeNeural',
				sender: client.user,
				voice_channel: currentChannel,
				connection: getVoiceConnection(guild.id),
			};
			BotLogs(guild.name, `${COLOR.blue}User ${COLOR.gray}[${COLOR.white}${newState.member.user.tag}${COLOR.gray}] ${COLOR.blue}left VC ${COLOR.gray}[${COLOR.white}${oldState.channel.name}${COLOR.gray}]`);
			addToQueue(guild.id, queue_constructor);
		}
		else if (currentChannel.members.size > 2) {
			const nick = await getUserNick(guild.id, newState.member.id);
			const queue_constructor = {
				uuid: generateUUID(),
				name: `${nick}บิดไปแล้ว`,
				lang: 'th',
				type: 'GOOGLE_TTS',
				guild: guild,
				voice: 'th-TH-PremwadeeNeural',
				sender: client.user,
				voice_channel: currentChannel,
				connection: getVoiceConnection(guild.id),
			};
			BotLogs(guild.name, `${COLOR.blue}User ${COLOR.gray}[${COLOR.white}${newState.member.user.tag}${COLOR.gray}] ${COLOR.blue}left VC ${COLOR.gray}[${COLOR.white}${oldState.channel.name}${COLOR.gray}]`);
			addToQueue(guild.id, queue_constructor);
		}
	}
});

client.on(Events.MessageCreate, async (message) => {
	if (!message.guild || message.author.bot || message.webhookId) return;

	const honeypotChannelId = client.honeypots?.get(message.guild.id);
	const isHoneypotChannel = honeypotChannelId && message.channel.id === honeypotChannelId;

	if (isHoneypotChannel) {
		if (
			message.member.permissions.has(PermissionFlagsBits.Administrator) ||
			message.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
			message.member.permissions.has(PermissionFlagsBits.BanMembers) ||
			message.author.id === message.guild.ownerId
		) {
			return;
		}

		try {
			await message.delete().catch(() => undefined);

			await message.member.ban({
				reason: 'Triggered Honeypot Trap (Sending message in decoy channel)',
				deleteMessageSeconds: 7 * 24 * 60 * 60,
			});

			BotLogs(message.guild.name, `${COLOR.red}Honeypot Triggered! Banned user: ${COLOR.white}${message.author.tag} (${message.author.id})${COLOR.reset}`);

			if (message.guild.systemChannel) {
				await message.guild.systemChannel.send({
					content: `🚨 **Honeypot Triggered!** Banned user **${message.author.tag}** (\`${message.author.id}\`) for sending a message in the decoy channel <#${message.channel.id}>.`,
				}).catch(() => undefined);
			}
		}
		catch (error) {
			BotLogs(message.guild.name, `${COLOR.red}Failed to execute honeypot action on ${message.author.tag}: ${error.toString()}`);
		}
		return;
	}

	const input = message.content.trim();
	if (input.endsWith('=')) {
		const expression = input.slice(0, -1).trim();
		if (expression) {
			const cleanExpr = expression.replace(/\^/g, '**');
			const mathRegex = new RegExp('^[0-9+\\-*/%().\\s]+$');
			if (mathRegex.test(cleanExpr) && /[0-9]/.test(cleanExpr)) {
				try {
					const result = Function('return (' + cleanExpr + ')')();
					if (result !== undefined && !isNaN(result)) {
						await message.reply(`🧮 **Result:** \`${result}\``);
					}
				}
				catch {
					// Ignore
				}
			}
		}
	}
});

setInterval(() => {
	try {
		const uptimeMs = client.uptime !== null ? client.uptime : Math.floor(process.uptime() * 1000);
		const readyTimestamp = client.readyTimestamp !== null ? client.readyTimestamp : (Date.now() - Math.floor(process.uptime() * 1000));

		let version = 'unknown';
		try {
			const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
			version = config.version || 'unknown';
		}
		catch {
			// Ignore
		}

		const memory = process.memoryUsage();
		const formatMemory = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

		const stats = {
			status: client.isReady() ? 'online' : 'offline',
			uptime: uptimeMs,
			readyTimestamp: readyTimestamp,
			ping: client.ws.ping !== null ? client.ws.ping : 0,
			version: version,
			timestamp: Date.now(),
			memory: {
				rss: formatMemory(memory.rss),
				heapUsed: formatMemory(memory.heapUsed),
				heapTotal: formatMemory(memory.heapTotal),
			},
		};

		fs.writeFileSync('./bot-stats.json', JSON.stringify(stats, null, 2), 'utf8');
	}
	catch (error) {
		BotLogs('SYSTEM', `Error writing bot-stats.json: ${error.toString()}`);
	}
}, 3000);

client.login(process.env.BOT_TOKEN);
