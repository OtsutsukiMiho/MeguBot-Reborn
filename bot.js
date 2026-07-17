require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client, ActivityType, Collection, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits, Partials } = require('discord.js');
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
	partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

let customReadyTimestamp = Date.now();
try {
	if (fs.existsSync('./database/restart_flag.json')) {
		const flagData = JSON.parse(fs.readFileSync('./database/restart_flag.json', 'utf8'));
		if (flagData.is_restarting && flagData.original_ready_timestamp) {
			customReadyTimestamp = flagData.original_ready_timestamp;
		}
		fs.writeFileSync('./database/restart_flag.json', JSON.stringify({ is_restarting: false }, null, 4));
	}
}
catch {
	// Ignore
}
client.customReadyTimestamp = customReadyTimestamp;

const { BotLogs, COLOR: COLOR } = require('./bot_functions.js');
const database = require('./database.js');

client.honeypots = new Map();
client.ttsChannels = new Map();

function getOrCreateConnection(guild, channel) {
	let connection = getVoiceConnection(guild.id);
	if ((!connection || connection.state.status === 'destroyed') && channel) {
		try {
			connection = joinVoiceChannel({
				channelId: channel.id,
				guildId: guild.id,
				adapterCreator: guild.voiceAdapterCreator,
			});
		}
		catch (error) {
			BotLogs(guild.name, `${COLOR.red}Failed to establish voice connection: ${error.toString()}`);
		}
	}
	return connection;
}

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

	try {
		client.ttsChannels = await database.getAllTtsChannels();
		BotLogs('SYSTEM', `${COLOR.green}TTS channel configurations successfully cached. Loaded ${client.ttsChannels.size} channels.`);
	}
	catch (error) {
		BotLogs('SYSTEM', `${COLOR.red}Error initializing TTS channel cache: ${error.toString()}`);
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

	setInterval(async () => {
		try {
			const now = Date.now();
			const activeReminders = await database.getActiveReminders();
			for (const r of activeReminders) {
				if (now >= r.reminder_time) {
					if (r.recurring) {
						const nextTime = r.reminder_time + 86400000;
						await database.updateReminderTime(r.id, nextTime);
					}
					else {
						await database.deleteReminder(r.id);
					}

					const guild = client.guilds.cache.get(r.guild_id);
					if (!guild) continue;

					const channel = guild.channels.cache.get(r.channel_id);
					if (channel) {
						await channel.send(`⏰ <@${r.user_id}>, **Reminder:** ${r.message}`).catch(() => undefined);
					}

					const member = await guild.members.fetch(r.user_id).catch(() => undefined);
					const botMember = guild.members.me;

					if (member && member.voice && member.voice.channel && botMember && botMember.voice && botMember.voice.channel && member.voice.channel.id === botMember.voice.channel.id) {
						const { addToQueue, generateUUID } = require('./audio_queue.js');
						let connection = getVoiceConnection(guild.id);
						if (!connection || connection.state.status === 'destroyed') {
							try {
								connection = joinVoiceChannel({
									channelId: botMember.voice.channel.id,
									guildId: guild.id,
									adapterCreator: guild.voiceAdapterCreator,
								});
							}
							catch {
								// Ignore
							}
						}

						if (connection) {
							const nick = await database.getUserNick(guild.id, r.user_id);
							const entry = {
								uuid: generateUUID(),
								name: `เตือนความจำคุณ ${nick} ${r.message}`,
								lang: 'th',
								type: 'GOOGLE_TTS',
								guild: guild,
								sender: client.user,
								voice_channel: botMember.voice.channel,
								connection: connection,
							};
							addToQueue(guild.id, entry);
						}
					}
				}
			}
		}
		catch (error) {
			BotLogs('SYSTEM', `Error in reminders interval: ${error.toString()}`);
		}
	}, 5000);
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

	else if (interaction.isModalSubmit()) {
		if (interaction.customId.startsWith('welcome_modal_')) {
			const channelId = interaction.customId.split('_')[2];
			const guildId = interaction.guild.id;
			const template = interaction.fields.getTextInputValue('welcome_message_input');

			try {
				await database.setGuildVar(guildId, 'welcome_channel_id', channelId);
				await database.setGuildVar(guildId, 'welcome_message_template', template);

				await interaction.reply({
					content: `✅ **Welcome message setup complete!**\n- Channel: <#${channelId}>\n- Template: \`\`\`${template}\`\`\``,
					flags: MessageFlags.Ephemeral,
				});
				BotLogs(interaction.guild.name, `${COLOR.green}Welcome message channel set to <#${channelId}> and template updated: ${COLOR.white}${template}`);
			}
			catch (error) {
				BotLogs(interaction.guild.name, `${COLOR.red}Error saving welcome template: ${error.toString()}`);
				await interaction.reply({
					content: '❌ **Error saving welcome template.** Please try again.',
					flags: MessageFlags.Ephemeral,
				});
			}
		}
		else if (interaction.customId.startsWith('leave_modal_')) {
			const channelId = interaction.customId.split('_')[2];
			const guildId = interaction.guild.id;
			const template = interaction.fields.getTextInputValue('leave_message_input');

			try {
				await database.setGuildVar(guildId, 'leave_channel_id', channelId);
				await database.setGuildVar(guildId, 'leave_message_template', template);

				await interaction.reply({
					content: `✅ **Leave message setup complete!**\n- Channel: <#${channelId}>\n- Template: \`\`\`${template}\`\`\``,
					flags: MessageFlags.Ephemeral,
				});
				BotLogs(interaction.guild.name, `${COLOR.green}Leave message channel set to <#${channelId}> and template updated: ${COLOR.white}${template}`);
			}
			catch (error) {
				BotLogs(interaction.guild.name, `${COLOR.red}Error saving leave template: ${error.toString()}`);
				await interaction.reply({
					content: '❌ **Error saving leave template.** Please try again.',
					flags: MessageFlags.Ephemeral,
				});
			}
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
				connection: getOrCreateConnection(guild, newState.channel),
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
			connection: getOrCreateConnection(guild, currentChannel),
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
				connection: getOrCreateConnection(guild, currentChannel),
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
				connection: getOrCreateConnection(guild, currentChannel),
			};
			BotLogs(guild.name, `${COLOR.blue}User ${COLOR.gray}[${COLOR.white}${newState.member.user.tag}${COLOR.gray}] ${COLOR.blue}left VC ${COLOR.gray}[${COLOR.white}${oldState.channel.name}${COLOR.gray}]`);
			addToQueue(guild.id, queue_constructor);
		}
	}

	if (newState.streaming && !oldState.streaming && newState.channelId === currentChannel.id && newState.member.id !== client.user.id) {
		const nick = await getUserNick(guild.id, newState.member.id);
		const { addToQueue, generateUUID } = require('./audio_queue.js');
		const queue_constructor = {
			uuid: generateUUID(),
			name: `${nick}ได้ทำการแชร์จอ`,
			lang: 'th',
			type: 'GOOGLE_TTS',
			guild: guild,
			voice: 'th-TH-PremwadeeNeural',
			sender: client.user,
			voice_channel: currentChannel,
			connection: getOrCreateConnection(guild, currentChannel),
		};
		BotLogs(guild.name, `${COLOR.blue}User ${COLOR.gray}[${COLOR.white}${newState.member.user.tag}${COLOR.gray}] ${COLOR.blue}started sharing screen in VC ${COLOR.gray}[${COLOR.white}${currentChannel.name}${COLOR.gray}]`);
		addToQueue(guild.id, queue_constructor);
	}
});

function formatAbbreviation(value) {
	if (typeof value !== 'number' || isNaN(value)) return null;

	const absVal = Math.abs(value);
	if (absVal >= 1000000000000) {
		return (value / 1000000000000).toFixed(2).replace(/\.00$/, '') + 't';
	}
	if (absVal >= 1000000000) {
		return (value / 1000000000).toFixed(2).replace(/\.00$/, '') + 'b';
	}
	if (absVal >= 1000000) {
		return (value / 1000000).toFixed(2).replace(/\.00$/, '') + 'm';
	}
	if (absVal >= 1000) {
		return (value / 1000).toFixed(2).replace(/\.00$/, '') + 'k';
	}
	return null;
}

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

	const ttsChannelId = client.ttsChannels?.get(message.guild.id);
	if (ttsChannelId && message.channel.id === ttsChannelId) {
		const voiceChannel = message.member?.voice.channel;
		if (!voiceChannel) {
			await message.react('🔇').catch(() => undefined);
			return;
		}

		const botMember = message.guild.members.me;
		const permissions = voiceChannel.permissionsFor(botMember);
		if (!permissions || !permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
			await message.react('❌').catch(() => undefined);
			return;
		}

		const connection = getOrCreateConnection(message.guild, voiceChannel);
		if (!connection) {
			await message.react('❌').catch(() => undefined);
			return;
		}

		const cleanText = message.content.trim();
		if (cleanText.length === 0) return;
		if (cleanText.length > 200) {
			await message.react('⚠️').catch(() => undefined);
			return;
		}

		const { addToQueue, generateUUID } = require('./audio_queue.js');
		const entry = {
			uuid: generateUUID(),
			name: cleanText,
			lang: 'th',
			type: 'GOOGLE_TTS',
			guild: message.guild,
			sender: message.author,
			voice_channel: voiceChannel,
			connection: connection,
		};

		const result = addToQueue(message.guild.id, entry);
		if (!result.success) {
			await message.react('❌').catch(() => undefined);
		}
		return;
	}

	const input = message.content.trim();

	const currencyRegex = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]{3})(?:\s+(?:to\s+)?([a-zA-Z]{3}))?\s*=$/;
	const currencyMatch = input.match(currencyRegex);
	if (currencyMatch) {
		const amount = parseFloat(currencyMatch[1]);
		const fromCurrency = currencyMatch[2].toUpperCase();
		let toCurrency = currencyMatch[3] ? currencyMatch[3].toUpperCase() : null;

		if (!toCurrency) {
			toCurrency = fromCurrency === 'THB' ? 'USD' : 'THB';
		}

		try {
			const response = await fetch(`https://open.er-api.com/v6/latest/${fromCurrency}`);
			if (!response.ok) throw new Error('API response not OK');

			const data = await response.json();
			if (data.result === 'success' && data.rates && data.rates[toCurrency]) {
				const rate = data.rates[toCurrency];
				const converted = (amount * rate).toFixed(2);

				const formattedAmount = amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
				const formattedConverted = parseFloat(converted).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

				await message.reply(`💱 **Currency Conversion:**\n\`${formattedAmount} ${fromCurrency}\` = \`${formattedConverted} ${toCurrency}\` (Rate: \`${rate.toFixed(4)}\`)`);
			}
		}
		catch (error) {
			BotLogs(message.guild.name, `Currency conversion error: ${error.toString()}`);
		}
		return;
	}

	if (input.endsWith('=')) {
		const expression = input.slice(0, -1).trim();
		if (expression) {
			let cleanExpr = expression.replace(/\^/g, '**');

			cleanExpr = cleanExpr.replace(/(\d+(?:\.\d+)?)\s*([kmbt])/gi, (match, num, unit) => {
				const val = parseFloat(num);
				const u = unit.toLowerCase();
				switch (u) {
				case 'k': return (val * 1000).toString();
				case 'm': return (val * 1000000).toString();
				case 'b': return (val * 1000000000).toString();
				case 't': return (val * 1000000000000).toString();
				default: return match;
				}
			});

			const mathRegex = new RegExp('^[0-9+\\-*/%().\\s]+$');
			if (mathRegex.test(cleanExpr) && /[0-9]/.test(cleanExpr)) {
				try {
					const result = Function('return (' + cleanExpr + ')')();
					if (result !== undefined && !isNaN(result)) {
						const abbrev = formatAbbreviation(result);
						const formattedFull = result.toLocaleString('en-US', { maximumFractionDigits: 4 });
						const replyText = abbrev
							? `🧮 **Result:** \`${formattedFull}\` (\`${abbrev}\`)`
							: `🧮 **Result:** \`${formattedFull}\``;
						await message.reply(replyText);
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
		const readyTimestamp = client.customReadyTimestamp || (client.readyTimestamp !== null ? client.readyTimestamp : (Date.now() - Math.floor(process.uptime() * 1000)));
		const uptimeMs = Date.now() - readyTimestamp;

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

client.on(Events.GuildMemberAdd, async (member) => {
	const guildId = member.guild.id;

	try {
		const autoRoleId = await database.getGuildVar(guildId, 'autorole_id');
		if (autoRoleId) {
			const role = member.guild.roles.cache.get(autoRoleId);
			if (role) {
				const botMember = member.guild.members.me;
				if (botMember && botMember.permissions.has(PermissionFlagsBits.ManageRoles) && botMember.roles.highest.position > role.position) {
					await member.roles.add(role);
					BotLogs(member.guild.name, `${COLOR.green}Auto-role assigned: added ${COLOR.white}${role.name}${COLOR.green} to user ${COLOR.white}${member.user.tag}`);
				}
				else {
					BotLogs(member.guild.name, `${COLOR.yellow}Warning: Failed to assign auto-role ${COLOR.white}${role.name}${COLOR.yellow} (missing permissions or role too high)`);
				}
			}
		}
	}
	catch (error) {
		BotLogs(member.guild.name, `${COLOR.red}Error executing auto-role for ${member.user.tag}: ${error.toString()}`);
	}

	try {
		const welcomeChannelId = await database.getGuildVar(guildId, 'welcome_channel_id');
		const template = await database.getGuildVar(guildId, 'welcome_message_template');
		if (welcomeChannelId && template) {
			const channel = member.guild.channels.cache.get(welcomeChannelId);
			if (channel) {
				const formattedMessage = template
					.replace(/{member}/g, `<@${member.id}>`)
					.replace(/{server}/g, member.guild.name);

				await channel.send(formattedMessage);
				BotLogs(member.guild.name, `${COLOR.green}Welcome message sent to channel ${COLOR.white}#${channel.name}${COLOR.green} for user ${COLOR.white}${member.user.tag}`);
			}
		}
	}
	catch (error) {
		BotLogs(member.guild.name, `${COLOR.red}Error executing welcome message for ${member.user.tag}: ${error.toString()}`);
	}
});

client.on(Events.GuildMemberRemove, async (member) => {
	const guildId = member.guild.id;

	try {
		const leaveChannelId = await database.getGuildVar(guildId, 'leave_channel_id');
		const template = await database.getGuildVar(guildId, 'leave_message_template');
		if (leaveChannelId && template) {
			const channel = member.guild.channels.cache.get(leaveChannelId);
			if (channel) {
				const username = member.user ? member.user.username : member.id;
				const formattedMessage = template
					.replace(/{member}/g, `<@${member.id}>`)
					.replace(/{username}/g, username)
					.replace(/{server}/g, member.guild.name);

				await channel.send(formattedMessage);
				BotLogs(member.guild.name, `${COLOR.green}Leave message sent to channel ${COLOR.white}#${channel.name}${COLOR.green} for user ${COLOR.white}${member.user ? member.user.tag : member.id}`);
			}
		}
	}
	catch (error) {
		BotLogs(member.guild.name, `${COLOR.red}Error executing leave message for ${member.user ? member.user.tag : member.id}: ${error.toString()}`);
	}
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
	if (reaction.partial) {
		try {
			await reaction.fetch();
		}
		catch (error) {
			BotLogs('SYSTEM', `Failed to fetch reaction partial: ${error.toString()}`);
			return;
		}
	}

	if (user.bot || !reaction.message.guild) return;

	const guildId = reaction.message.guild.id;
	const messageId = reaction.message.id;
	const emojiKey = reaction.emoji.id || reaction.emoji.name;

	try {
		const rawMap = await database.getGuildVar(guildId, 'reaction_roles');
		if (rawMap) {
			const mappings = JSON.parse(rawMap);
			const messageMappings = mappings[messageId];
			if (messageMappings && messageMappings[emojiKey]) {
				const roleId = messageMappings[emojiKey];
				const guild = reaction.message.guild;
				const role = guild.roles.cache.get(roleId);
				if (role) {
					const member = await guild.members.fetch(user.id).catch(() => undefined);
					if (member) {
						const botMember = guild.members.me;
						if (botMember && botMember.permissions.has(PermissionFlagsBits.ManageRoles) && botMember.roles.highest.position > role.position) {
							await member.roles.add(role);
							BotLogs(guild.name, `${COLOR.green}Reaction role assigned: added ${COLOR.white}${role.name}${COLOR.green} to user ${COLOR.white}${user.tag} for emoji ${COLOR.white}${reaction.emoji.name}`);
						}
						else {
							BotLogs(guild.name, `${COLOR.yellow}Warning: Failed to assign reaction role ${COLOR.white}${role.name}${COLOR.yellow} (missing permissions)`);
						}
					}
				}
			}
		}
	}
	catch (error) {
		BotLogs(reaction.message.guild.name, `${COLOR.red}Error assigning reaction role: ${error.toString()}`);
	}
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
	if (reaction.partial) {
		try {
			await reaction.fetch();
		}
		catch (error) {
			BotLogs('SYSTEM', `Failed to fetch reaction partial: ${error.toString()}`);
			return;
		}
	}

	if (user.bot || !reaction.message.guild) return;

	const guildId = reaction.message.guild.id;
	const messageId = reaction.message.id;
	const emojiKey = reaction.emoji.id || reaction.emoji.name;

	try {
		const rawMap = await database.getGuildVar(guildId, 'reaction_roles');
		if (rawMap) {
			const mappings = JSON.parse(rawMap);
			const messageMappings = mappings[messageId];
			if (messageMappings && messageMappings[emojiKey]) {
				const roleId = messageMappings[emojiKey];
				const guild = reaction.message.guild;
				const role = guild.roles.cache.get(roleId);
				if (role) {
					const member = await guild.members.fetch(user.id).catch(() => undefined);
					if (member) {
						const botMember = guild.members.me;
						if (botMember && botMember.permissions.has(PermissionFlagsBits.ManageRoles) && botMember.roles.highest.position > role.position) {
							await member.roles.remove(role);
							BotLogs(guild.name, `${COLOR.green}Reaction role removed: took ${COLOR.white}${role.name}${COLOR.green} from user ${COLOR.white}${user.tag} for emoji ${COLOR.white}${reaction.emoji.name}`);
						}
						else {
							BotLogs(guild.name, `${COLOR.yellow}Warning: Failed to remove reaction role ${COLOR.white}${role.name}${COLOR.yellow} (missing permissions)`);
						}
					}
				}
			}
		}
	}
	catch (error) {
		BotLogs(reaction.message.guild.name, `${COLOR.red}Error removing reaction role: ${error.toString()}`);
	}
});

process.on('message', (msg) => {
	if (msg && msg.type === 'ping') {
		BotLogs('SYSTEM', `${COLOR.green}Received Ping IPC from Web Server! Bot is alive and responsive! (Ready: ${client.isReady()})`);
	}
});

client.on('warn', (info) => BotLogs('SYSTEM', `${COLOR.yellow}[Discord Warn] ${info}`));
client.on('error', (error) => BotLogs('SYSTEM', `${COLOR.red}[Discord Error] ${error.stack || error.toString()}`));
client.on('shardError', (error, shardId) => BotLogs('SYSTEM', `${COLOR.red}[Discord Shard ${shardId} Error] ${error.stack || error.toString()}`));

BotLogs('SYSTEM', `${COLOR.green}Starting...`);
client.login(process.env.BOT_TOKEN);
BotLogs('SYSTEM', `${COLOR.green}Done!`);