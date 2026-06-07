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

// Initialize honeypot cache and load existing settings on startup
client.honeypots = new Map();
try {
	const varsDir = './database/variables';
	if (fs.existsSync(varsDir)) {
		const files = fs.readdirSync(varsDir).filter(file => file.endsWith('.json'));
		for (const file of files) {
			const guildId = path.basename(file, '.json');
			const rawData = fs.readFileSync(path.join(varsDir, file), 'utf8');
			if (rawData.trim()) {
				const data = JSON.parse(rawData);
				if (data.honeypot_channel_id) {
					client.honeypots.set(guildId, data.honeypot_channel_id);
				}
			}
		}
	}
}
catch (error) {
	BotLogs('SYSTEM', `${COLOR.red}Error initializing honeypot cache: ${error.toString()}`);
}

function autoJoinActiveVC(guild) {
	const voiceChannels = guild.channels.cache.filter(channel => channel.type === 2);
	for (const [channelId, voiceChannel] of voiceChannels) {
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

	for (const [guildId, guild] of readyClient.guilds.cache) {
		const botMember = guild.members.me;
		let joined = false;

		if (botMember && botMember.voice && botMember.voice.channel) {
			const voiceChannel = botMember.voice.channel;

			if (guild.afkChannelId && voiceChannel.id === guild.afkChannelId) {
			}
			else if (voiceChannel.members.size > 1) {
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
		};
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

function getUserNick(guildId, userId) {
	const dbPath = `./database/nick/${guildId}.json`;
	if (fs.existsSync(dbPath)) {
		try {
			const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
			if (data.users && Array.isArray(data.users)) {
				const user = data.users.find(u => u.id === userId);
				if (user && user.name) return user.name;
			}
			else if (data[userId]) {
				return data[userId];
			}
		}
		catch (e) { }
	}
	return 'ใครไม่รู้';
}

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
	const guild = newState.guild || oldState.guild;
	const botMember = guild.members.me;

	let totalVoiceMembers = 0;
	guild.channels.cache.filter(c => c.type === 2).forEach(vc => {
		totalVoiceMembers += vc.members.size;
	});

	if (totalVoiceMembers === 0) {
		const dbPath = `./database/variables/${guild.id}.json`;
		if (fs.existsSync(dbPath)) {
			try {
				const guildData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
				if (guildData.old_vc_id) {
					delete guildData.old_vc_id;
					fs.writeFileSync(dbPath, JSON.stringify(guildData, null, 4));
				}
			}
			catch (e) { }
		}

		const { clearQueue } = require('./audio_queue.js');
		clearQueue(guild.id, guild.name);

		const { getVoiceConnection } = require('@discordjs/voice');
		const connection = getVoiceConnection(guild.id);
		if (connection) {
			connection.destroy();
		}
	}

	if (newState.member.id === client.user.id && newState.channelId && oldState.channelId !== newState.channelId) {
		const dbPath = `./database/variables/${guild.id}.json`;
		let guildData = {};

		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		if (fs.existsSync(dbPath)) {
			try {
				guildData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
			}
			catch (e) { }
		}

		if (!guildData.old_vc_id) {
			guildData.old_vc_id = newState.channelId;
			fs.writeFileSync(dbPath, JSON.stringify(guildData, null, 4));

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
		else if (guildData.old_vc_id !== newState.channelId) {
			guildData.old_vc_id = newState.channelId;
			fs.writeFileSync(dbPath, JSON.stringify(guildData, null, 4));
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
		newState.member.voice.setChannel(oldState.channel).catch(() => { });
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
				botMember.voice.setChannel(null).catch(() => { });
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
		const nick = getUserNick(guild.id, newState.member.id);
		const { addToQueue, generateUUID } = require('./audio_queue.js');
		const { getVoiceConnection } = require('@discordjs/voice');
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
		const { getVoiceConnection } = require('@discordjs/voice');

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
			const nick = getUserNick(guild.id, newState.member.id);
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
	if (!honeypotChannelId || message.channel.id !== honeypotChannelId) return;

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
});

client.login(process.env.BOT_TOKEN);