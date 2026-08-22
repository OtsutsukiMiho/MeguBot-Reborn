const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// Two copies of the bot running on one token both receive every event and both
// answer it, which in Discord reads as the bot replying twice. Neither process
// can see its twin, so each one stamps who it is.
//
// The boot line below carries it, and so does every slash command — into
// audit_logs, which lives in the shared database. That is the part that matters:
// two instances deployed in different places have console logs nobody can put
// side by side, but they write to the same table, so a duplicate shows up there
// as two rows for one invocation with two different stamps.
const INSTANCE = `${os.hostname()}#${process.pid}.${crypto.randomBytes(2).toString('hex')}`;

if (fs.existsSync('.env')) {
	require('dotenv').config();
}
const { Client, ActivityType, Collection, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits, Partials, EmbedBuilder, Routes, AuditLogEvent } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const DISCORD_TEST_MODE = process.env.MEGU_DISCORD_TEST_MODE === '1';
const DISCORD_TEST_GUILD_ID = String(process.env.MEGU_DISCORD_TEST_GUILD_ID || '');
const DISCORD_TEST_CHANNEL_ID = String(process.env.MEGU_DISCORD_TEST_CHANNEL_ID || '');
const client = new Client({
	intents: DISCORD_TEST_MODE ? [GatewayIntentBits.Guilds] : [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildModeration,
		GatewayIntentBits.GuildInvites,
		GatewayIntentBits.GuildVoiceStates,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.DirectMessageReactions,
		GatewayIntentBits.MessageContent,
	],
	partials: [Partials.Message, Partials.Channel, Partials.Reaction],

	// discord.js's REST defaults are tuned for a bot with an IP to itself. This
	// one shares an egress IP on a cloud tier, and Cloudflare polices datacenter
	// ranges by IP, so the defaults are the wrong end of every trade-off here.
	//
	// `rejectOnRateLimit` is the one that matters, and it is not a tuning knob —
	// it is the difference between a bot that stops when it is refused and one
	// that cannot. Read what @discordjs/rest does with an unexpected 429
	// (RequestManager, `runRequest`):
	//
	//     await sleep(retryAfter);
	//     return this.runRequest(routeId, url, options, requestData, retries);
	//
	// `retries` is passed through unchanged, not incremented. There is no cap on
	// that path: as long as Discord keeps answering 429, that call sleeps and
	// sends again, forever. A Cloudflare block answers 429 to everything, so
	// every in-flight request in this process turns into a permanent retry loop
	// against an IP that is banned *because of traffic* — and the promise never
	// settles, so no `.catch()` anywhere above it ever runs. That is why the
	// block kept renewing itself and why nothing in the logs explained it.
	//
	// Rejecting instead hands the failure back to the caller, which is what lets
	// the guard below see it and shut the process up.
	//
	// The other two are ordinary caution: `retries: 3` makes one failed request
	// into three, and 50 requests a second is the ceiling for a bot alone on its
	// address, which this one is not.
	rest: {
		retries: 1,
		globalRequestsPerSecond: 25,
		rejectOnRateLimit: (data) => shouldStopForRateLimit(data),
	},
});

// Which rate limits get waited out and which have to fail is decided by
// isSevereRateLimit — see adapters/discord/rate-limit.js for why the default
// behaviour cannot be used here. This end is the policy that follows from it:
// say so in the logs, and treat a run of them as the block arriving.
const SEVERE_429_WINDOW_MS = 60 * 1000;
const SEVERE_429_LIMIT = 3;
let severeRateLimits = [];

function shouldStopForRateLimit(data) {
	if (!isSevereRateLimit(data)) return false;

	const isGlobal = Boolean(data.global) || data.scope === 'global';
	BotLogs('SYSTEM', `${COLOR.yellow}[Discord Rate Limit] ${data.method} ${data.route} — ${data.timeToReset}ms${isGlobal ? ' (GLOBAL)' : ''}. Failing the call rather than retrying into it.`);

	// One of these can be a coincidence. Three inside a minute is a pattern, and
	// stopping voluntarily for fifteen minutes is enormously cheaper than being
	// stopped involuntarily for an hour.
	const now = Date.now();
	severeRateLimits = severeRateLimits.filter(at => now - at < SEVERE_429_WINDOW_MS);
	severeRateLimits.push(now);
	if (severeRateLimits.length >= SEVERE_429_LIMIT && !discordBlock.blocked()) {
		BotLogs('SYSTEM', `${COLOR.red}${severeRateLimits.length} severe rate limits in the last minute. Backing off before Discord does it for us.`);
		severeRateLimits = [];
		discordBlock.trip();
	}

	return true;
}

let customReadyTimestamp = Date.now();
const restartFlagPath = path.join(__dirname, '../database/data/restart_flag.json');
try {
	if (fs.existsSync(restartFlagPath)) {
		const flagData = JSON.parse(fs.readFileSync(restartFlagPath, 'utf8'));
		if (flagData.is_restarting && flagData.original_ready_timestamp) {
			customReadyTimestamp = flagData.original_ready_timestamp;
		}
		fs.writeFileSync(restartFlagPath, JSON.stringify({ is_restarting: false }, null, 4));
	}
}
catch {
	// Ignore
}
client.customReadyTimestamp = customReadyTimestamp;

const { BotLogs, COLOR: COLOR, parseReactionRolesMap } = require('./bot_functions.js');
const database = require('../database/database.js');
const { isGlobalBlock, isSevereRateLimit, createBlockGuard, BLOCK_EXIT_CODE } = require('../../adapters/discord/rate-limit.js');

// The web process has had this guard since the outage. The bot never did, and
// the bot is the process that talks to Discord constantly — so while the site
// was correctly showing "we are blocked, do not retry", this half of the deploy
// was still editing a heartbeat message, pulling audit logs on every event and
// fetching member rosters, straight into a ban that lengthens under traffic.
// Every one of those calls was wrapped in `.catch(() => undefined)`, so nothing
// was logged and nothing ever noticed.
//
// Everything below exists to make that impossible: ask before calling, and hand
// every failure to the guard instead of swallowing it.
const discordBlock = createBlockGuard({
	onTrip: (seconds) => {
		BotLogs('SYSTEM', `${COLOR.red}Discord has blocked this server's IP. Pausing every Discord call for ${Math.round(seconds / 60)} minutes — see DISCORD-RATE-LIMITS.md.`);
		if (process.send) {
			try { process.send({ type: 'discord_block', untilMs: discordBlock.blockedUntil() }); }
			catch {}
		}
	},
});

// A child that starts mid-block comes up believing nothing is wrong. The
// supervisor is the only thing here that outlives a restart, so ask it.
if (process.send) {
	try { process.send({ type: 'discord_block_query' }); }
	catch {}
}

/**
 * The one way this process is allowed to call Discord.
 *
 * Skips the call outright while blocked, and feeds anything that fails to the
 * guard so the first refusal shuts the rest of the process up rather than being
 * swallowed by a `.catch(() => undefined)` and repeated by the next caller.
 *
 * Returns `fallback` in both cases, so callers keep the shape they had when
 * they were catching failures themselves.
 */
async function discordCall(label, run, fallback = undefined) {
	if (discordBlock.blocked()) return fallback;
	try {
		return await run();
	}
	catch (error) {
		if (discordBlock.record(error)) {
			BotLogs('SYSTEM', `${COLOR.red}Blocked by Discord while ${label}. Everything else is paused too.`);
		}
		return fallback;
	}
}

/** Audit-log reads happen on nearly every moderation event, so they get a name. */
function guardedAuditLogs(guild, options) {
	return discordCall('reading audit logs', () => guild.fetchAuditLogs(options), null);
}

/**
 * Append this process's identity to an audit line, so `npm run bot:instances`
 * can tell one copy of the bot from another.
 *
 * Only slash commands carried the stamp at first, and slash commands turned out
 * to be far too rare to answer with — thirty days of them was twenty-one rows,
 * and a whole day could pass with none, which reads in the audit as "nothing is
 * running" when the bot is up and busy. TTS is the opposite: it fires twenty-odd
 * times a day on ordinary use, so stamping it is what makes the question
 * answerable at all.
 *
 * Anything written often enough to be a useful sample should go through here.
 */
function stamp(details) {
	return `${details} [${INSTANCE}]`;
}

// `GET /guilds/{id}/members?limit=1000` is the single most expensive thing this
// bot asks Discord for, and the dashboard used to ask for it twice on every page
// load: once to render the server overview, once more when the Member Manager
// tab opened. Three refreshes was six full roster pulls, uncached, on one of the
// tightest per-guild buckets there is.
//
// A minute of staleness is invisible in a settings dashboard and turns a burst
// of refreshes into one request. On failure — including while blocked — the last
// good roster is served rather than nothing, because a stale member list is a
// far better answer than an empty one.
const ROSTER_TTL_MS = 60 * 1000;
const rosterCache = new Map();

function mapRawMember(m) {
	const u = m.user || {};
	return {
		id: u.id,
		username: u.username || 'Unknown',
		displayName: m.nick || u.global_name || u.username || 'Unknown',
		avatar: u.avatar
			? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
			: `https://cdn.discordapp.com/embed/avatars/${Number(u.discriminator || 0) % 5}.png`,
		isBot: !!u.bot,
		roles: Array.isArray(m.roles) ? m.roles : [],
	};
}

async function fetchGuildRoster(guildId, query = '') {
	const key = `${guildId}:${query}`;
	const cached = rosterCache.get(key);
	if (cached && Date.now() - cached.at < ROSTER_TTL_MS) return cached.members;

	const raw = await discordCall('listing server members', () => (query
		? client.rest.get(Routes.guildMembersSearch(guildId), { query: new URLSearchParams({ query, limit: '100' }) })
		: client.rest.get(Routes.guildMembers(guildId), { query: new URLSearchParams({ limit: '1000' }) })
	), null);

	if (!Array.isArray(raw) || raw.length === 0) return cached ? cached.members : null;

	const members = raw.map(mapRawMember);
	if (rosterCache.size > 50) rosterCache.clear();
	rosterCache.set(key, { at: Date.now(), members });
	return members;
}

/**
 * The dashboard's shape of a member list, read out of the gateway cache.
 *
 * discord.js already holds these — they arrived over the websocket under the
 * GuildMembers intent and cost Discord nothing to read again. `fetchGuildRoster`
 * above is the same answer bought with `GET /guilds/{id}/members?limit=1000`,
 * the most expensive request this bot makes, so both roster screens now ask
 * here first and fall back to one capped `members.fetch` only when the cache is
 * genuinely empty — a fresh boot, or a guild large enough that the gateway did
 * not send everyone.
 *
 * That leaves `fetchGuildRoster` with no callers. It is kept rather than
 * deleted because its one-minute cache and serve-the-last-good-roster-while-
 * blocked behaviour are the answer if the gateway cache ever proves too thin
 * here — but nothing reaches it today, and anything that calls it again is
 * choosing the expensive route on purpose.
 *
 * `query` filters in memory. A search box that goes to Discord per search is a
 * request per keystroke on a per-guild bucket, and the answer was usually
 * already local.
 */
function mapGuildMembers(guild, query = '') {
	const needle = String(query || '').trim().toLowerCase();
	return Array.from(guild.members.cache.values())
		.filter((m) => {
			if (!needle) return true;
			const u = m.user || {};
			return (m.displayName || '').toLowerCase().includes(needle)
				|| (u.username || '').toLowerCase().includes(needle)
				|| (u.globalName || '').toLowerCase().includes(needle)
				|| m.id.includes(needle);
		})
		.map((m) => {
			const u = m.user || {};
			return {
				id: m.id,
				username: u.username || 'Unknown',
				displayName: m.displayName || u.globalName || u.username || 'Unknown',
				avatar: (u.avatarURL && u.avatarURL({ size: 64 })) || u.defaultAvatarURL || null,
				isBot: Boolean(u.bot),
				roles: Array.from(m.roles.cache.keys()).filter(id => id !== guild.id),
			};
		});
}

// The online-ping status message. Boot-time Discord work has to be cheap enough
// to survive a restart loop, and this used to be four calls every single boot:
// fetch the channel, fetch ten messages, `bulkDelete` them, post a new one.
// bulkDelete is one of the most tightly limited routes there is, and on a host
// that restarts on deploy, on crash and on wake from idle, "every boot" is a lot
// of boots.
//
// Now it looks for the message it left last time and edits that. Two calls, no
// deletes, and nothing accumulates in the channel — which is why it recognises
// its own message rather than remembering an id: a cloud filesystem does not
// survive the restart either, so anything written down would be gone exactly
// when it was needed.
const ONLINE_PING_CHANNEL_ID = '1225208114941399110';
const HEARTBEAT_MS = 5 * 60 * 1000;

function onlinePingText() {
	return `🟢 **Megu is Online!**\nLast Checked: ${new Date().toLocaleTimeString()}\nPing: ${client.ws.ping}ms`;
}

async function startOnlinePing() {
	const channel = await discordCall('fetching the status channel', () => client.channels.fetch(ONLINE_PING_CHANNEL_ID), null);
	if (!channel) return;

	const recent = await discordCall('looking for the last status message', () => channel.messages.fetch({ limit: 5 }), null);
	let statusMessage = recent ? recent.find(m => m.author?.id === client.user.id) : null;

	if (statusMessage) {
		await discordCall('updating the status message', () => statusMessage.edit(onlinePingText()));
	}
	else {
		statusMessage = await discordCall('posting the status message', () => channel.send(onlinePingText()), null);
		if (!statusMessage) return;
	}

	// Every 5 minutes, not every 3–9 seconds. The old loop edited this one
	// message roughly 10,000 times a day for no reader's benefit, which is
	// exactly the sustained traffic that gets an IP blocked. A liveness stamp is
	// still a liveness stamp at five-minute resolution.
	//
	// It also stops itself: if the edit fails twice in a row the channel is
	// gone, the message was deleted, or Discord is refusing us — and in all
	// three cases retrying forever is the wrong answer.
	let consecutiveFailures = 0;
	const heartbeat = setInterval(async () => {
		if (discordBlock.blocked()) return;
		const edited = await discordCall('updating the status message', () => statusMessage.edit(onlinePingText()), null);
		if (edited) {
			consecutiveFailures = 0;
			return;
		}
		consecutiveFailures += 1;
		BotLogs('SYSTEM', `${COLOR.red}Online-ping heartbeat failed (${consecutiveFailures}/2).`);
		if (consecutiveFailures >= 2) {
			clearInterval(heartbeat);
			BotLogs('SYSTEM', `${COLOR.yellow}Online-ping heartbeat stopped. Restart the bot to bring it back.`);
		}
	}, HEARTBEAT_MS);
	heartbeat.unref();
}

client.honeypots = new Map();
client.ttsChannels = new Map();
client.automodConfigs = new Map();
const userTtsHistoryMap = new Map();

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
	BotLogs('Bot', `${COLOR.green}Discord client connected -> ${COLOR.white}${readyClient.user.tag}`);
	// If you see this line twice for one deploy, or once here and once in
	// another host's log, that is the bot answering twice.
	BotLogs('Bot', `${COLOR.green}Gateway instance ${COLOR.white}${INSTANCE}${COLOR.reset} — one token, one of these. Two means duplicate replies.`);

	await database.initDatabase();
	if (DISCORD_TEST_MODE) {
		try {
			const core = require('../../core/index.js');
			core.setLogger((scope, message) => BotLogs(scope, message));
			await core.initCoreSchema();
			BotLogs('Megu', `${COLOR.yellow}Discord test mode: only /จ่าย in ${DISCORD_TEST_GUILD_ID}/${DISCORD_TEST_CHANNEL_ID}`);
		}
		catch (error) {
			BotLogs('Megu', `${COLOR.red}Test-mode core init failed: ${error.message}`);
		}
		return;
	}

	// Megu chases unpaid shares by DM. Core decides who and what to say; the
	// sender only opens the conversation.
	try {
		const core = require('../../core/index.js');
		const reminderSender = require('../../adapters/discord/reminder-sender.js');
		core.setLogger((scope, message) => BotLogs(scope, message));
		await core.initCoreSchema();
		reminderSender.start(client, {
			baseUrl: process.env.FRONTEND_URL || '',
			intervalMs: Number(process.env.MEGU_REMINDER_INTERVAL_MS) || undefined,
			// A sweep is one DM per person in a loop. It is the largest burst
			// this bot ever produces, so it asks before starting and stops the
			// moment Discord refuses one.
			isBlocked: () => discordBlock.blocked(),
			recordFailure: (error) => discordBlock.record(error),
		});
		BotLogs('Megu', `${COLOR.green}Reminder loop armed on ${COLOR.white}${core.db.describe()}`);
	}
	catch (error) {
		BotLogs('Megu', `${COLOR.red}Reminder loop not started: ${error.message}`);
	}

	try {
		client.honeypots = await database.getAllHoneypots();
		BotLogs('Bot', `${COLOR.green}Cached honeypots ${COLOR.gray}(${COLOR.white}${client.honeypots.size} channels${COLOR.gray})`);
	}
	catch (error) {
		BotLogs('Bot', `${COLOR.red}Failed to cache honeypots: ${error.message}`);
	}

	try {
		client.ttsChannels = await database.getAllTtsChannels();
		BotLogs('Bot', `${COLOR.green}Cached TTS channels ${COLOR.gray}(${COLOR.white}${client.ttsChannels.size} channels${COLOR.gray})`);
	}
	catch (error) {
		BotLogs('Bot', `${COLOR.red}Failed to cache TTS channels: ${error.message}`);
	}

	try {
		client.automodConfigs = await database.getAllAutoModConfigs();
		BotLogs('Bot', `${COLOR.green}Cached AutoMod profiles ${COLOR.gray}(${COLOR.white}${client.automodConfigs.size} servers${COLOR.gray})`);
	}
	catch (error) {
		BotLogs('Bot', `${COLOR.red}Failed to cache AutoMod profiles: ${error.message}`);
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
					BotLogs('Bot', `${COLOR.blue}Reconnected voice channel -> ${COLOR.white}${voiceChannel.name} ${COLOR.gray}(${guild.name})`);
					joined = true;
				}
				catch (error) {
					BotLogs('Bot', `${COLOR.red}Failed to reconnect voice channel: ${error.message}`);
				}
			}
		}

		if (!joined) {
			autoJoinActiveVC(guild);
		}
	}

	setInterval(async () => {
		try {
			// Polling the database on a timer is fine; the rule is about Discord.
			// But the row is deleted before the message is sent, so running this
			// while blocked would drop the reminder on the floor as well as add
			// traffic. Skipping the whole tick leaves everything due, and it goes
			// out on the first tick after the block clears.
			if (discordBlock.blocked()) return;

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
						await discordCall('sending a reminder', () => channel.send(`⏰ <@${r.user_id}>, **Reminder:** ${r.message}`));
					}

					const member = await discordCall('fetching a reminder recipient', () => guild.members.fetch(r.user_id));
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

const foldersPath = path.join(__dirname, '../../commands');
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
	if (DISCORD_TEST_MODE) {
		if (String(interaction.guildId || '') !== DISCORD_TEST_GUILD_ID) return;
		if (String(interaction.channelId || '') !== DISCORD_TEST_CHANNEL_ID) return;
		if (interaction.commandName !== 'จ่าย') return;
	}

	if (interaction.isChatInputCommand()) {
		const command = interaction.client.commands.get(interaction.commandName);
		if (!command) return;

		try {
			await command.execute(interaction);
			if (interaction.guild) {
				const optsStr = interaction.options.data ? interaction.options.data.map(o => `${o.name}:${o.value}`).join(' ') : '';
				database.logAuditEvent(
					interaction.guild.id,
					'COMMAND_EXEC',
					interaction.user.id,
					interaction.user.username,
					stamp(`Executed /${interaction.commandName} ${optsStr}`.trim()),
					interaction.guild.name
				).catch(() => undefined);
			}
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
			BotLogs('SYSTEM', `${COLOR.red}Error Occurred: ${COLOR.white}"${error.toString().replace(/^Error: /, '')}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"`);
			BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
			try {
				if (interaction.replied || interaction.deferred) {
					await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral }).catch(() => {});
				}
				else {
					await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral }).catch(() => {});
				}
			}
			catch {}
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
	if (DISCORD_TEST_MODE) return;
	// Set once, not on a timer. Discord allows 5 presence updates per 60
	// seconds per session; this used to re-send the same unchanged presence
	// every 5 seconds — 12 a minute, forever — which is a straight 12x overrun
	// and one of the things that got the deploy's IP blocked. discord.js keeps
	// the presence on the client and replays it in the IDENTIFY payload, so a
	// reconnect restores it without us sending anything.
	try {
		const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
		client.user.setPresence({
			status: 'online',
			activities: [{
				name: `Megu | V ${config.version}`,
				type: ActivityType.Custom,
			}],
		});
	}
	catch (error) {
		BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
		BotLogs('SYSTEM', `${COLOR.red}Error Occurred: ${COLOR.white}"${error.toString().replace(/^Error: /, '')}" ${COLOR.red}from ${COLOR.white}"${path.basename(__filename)}"`);
		BotLogs('SYSTEM', `${COLOR.red}---------------------------------------------------------------`);
	}

	try {
		const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
		if (config.online_ping) {
			// The same five-minute liveness stamp, with every call to Discord
			// routed through the block guard and the interval skipping itself
			// while blocked. See startOnlinePing.
			startOnlinePing().catch(() => undefined);
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

			BotLogs('Bot', `${COLOR.blue}Greeting voice channel -> ${COLOR.white}${newState.channel.name} ${COLOR.gray}(${guild.name})`);

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

function toBool(val, defaultVal = true) {
	if (val === undefined || val === null) return defaultVal;
	if (val === false || val === 'false' || val === 0 || val === '0') return false;
	if (val === true || val === 'true' || val === 1 || val === '1') return true;
	return Boolean(val);
}

	const afkBringbackEnabled = toBool(await database.getGuildVar(guild.id, 'tts_afk_bringback_enabled'));
	if (afkBringbackEnabled && newState.channelId === guild.afkChannelId && oldState.channelId === currentChannel.id && newState.member.id !== botMember.id) {
		newState.member.voice.setChannel(oldState.channel).catch(() => undefined);
		BotLogs('Bot', `${COLOR.blue}AFK Bringback: Moved ${COLOR.white}${newState.member.user.username}${COLOR.blue} from AFK -> ${COLOR.white}${oldState.channel.name} ${COLOR.gray}(${guild.name})`);
		database.logAuditEvent(
			guild.id,
			'VOICE_TTS',
			newState.member.id,
			newState.member.user.username,
			stamp(`AFK Bringback: Moved ${newState.member.user.username} from AFK to <#${oldState.channel.id}>`),
			guild.name
		).catch(() => undefined);
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

	const ttsEngine = (await database.getGuildVar(guild.id, 'tts_engine')) || 'EDGE_TTS';
	const ttsVoice = (await database.getGuildVar(guild.id, 'tts_voice')) || 'th-TH-NiwatNeural';
	const ttsLang = (await database.getGuildVar(guild.id, 'tts_lang')) || 'th';
	const speechType = ttsEngine === 'GOOGLE_TTS' ? 'GOOGLE_TTS' : 'TTS';

	const vcWelcomeEnabled = toBool(await database.getGuildVar(guild.id, 'tts_vc_welcome_enabled'));
	const vcWelcomeTemplate = (await database.getGuildVar(guild.id, 'tts_vc_welcome_template')) || '{username} เข้าดิสมา';

	if (vcWelcomeEnabled && newState.channelId === currentChannel.id && oldState.channelId !== currentChannel.id && oldState.channelId !== guild.afkChannelId) {
		const member = newState.member || (await discordCall('fetching a voice member', () => guild.members.fetch(newState.id), null));
		if (member && member.id !== client.user.id) {
			const dbNick = await getUserNick(guild.id, member.id);
			const customNick = (dbNick && dbNick !== 'ใครไม่รู้') ? dbNick : null;
			const discordDisplayName = member.nickname || member.displayName || member.user?.globalName || member.user?.username || 'User';
			const spokenNick = customNick || discordDisplayName;
			const userTag = member.user ? member.user.username : discordDisplayName;

			const formattedWelcome = vcWelcomeTemplate
				.replace(/{displayname}/gi, discordDisplayName)
				.replace(/{nickname}/gi, spokenNick)
				.replace(/{username}/gi, spokenNick)
				.replace(/{tag}/gi, userTag)
				.replace(/{server}/gi, guild.name);

			const { addToQueue, generateUUID } = require('./audio_queue.js');
			const queue_constructor = {
				uuid: generateUUID(),
				name: formattedWelcome,
				lang: ttsLang,
				type: speechType,
				guild: guild,
				voice: ttsVoice,
				sender: client.user,
				voice_channel: currentChannel,
				connection: getOrCreateConnection(guild, currentChannel),
			};
			BotLogs('Tts', `${COLOR.blue}VC Join Greeting for ${COLOR.white}${userTag}${COLOR.blue} -> "${formattedWelcome}" ${COLOR.gray}(${guild.name})`);
			database.logAuditEvent(
				guild.id,
				'VOICE_TTS',
				member.id,
				userTag,
				stamp(`VC Join Greeting spoken: "${formattedWelcome}"`),
				guild.name
			).catch(() => undefined);
			addToQueue(guild.id, queue_constructor);
		}
	}

	const vcLeaveEnabled = toBool(await database.getGuildVar(guild.id, 'tts_vc_leave_enabled'));
	const vcLeaveTemplate = (await database.getGuildVar(guild.id, 'tts_vc_leave_template')) || '{username} ออกจากดิสแล้ว';

	if (vcLeaveEnabled && oldState.channelId === currentChannel.id && newState.channelId !== currentChannel.id) {
		const member = oldState.member || newState.member || (await discordCall('fetching a voice member', () => guild.members.fetch(oldState.id), null));
		if (member && member.id !== client.user.id) {
			const dbNick = await getUserNick(guild.id, member.id);
			const customNick = (dbNick && dbNick !== 'ใครไม่รู้') ? dbNick : null;
			const discordDisplayName = member.nickname || member.displayName || member.user?.globalName || member.user?.username || 'User';
			const spokenNick = customNick || discordDisplayName;
			const userTag = member.user ? member.user.username : discordDisplayName;

			const formattedLeave = vcLeaveTemplate
				.replace(/{displayname}/gi, discordDisplayName)
				.replace(/{nickname}/gi, spokenNick)
				.replace(/{username}/gi, spokenNick)
				.replace(/{tag}/gi, userTag)
				.replace(/{server}/gi, guild.name);

			const { addToQueue, generateUUID } = require('./audio_queue.js');
			const queue_constructor = {
				uuid: generateUUID(),
				name: formattedLeave,
				lang: ttsLang,
				type: speechType,
				guild: guild,
				voice: ttsVoice,
				sender: client.user,
				voice_channel: currentChannel,
				connection: getOrCreateConnection(guild, currentChannel),
			};
			BotLogs('Tts', `${COLOR.blue}VC Leave Goodbye for ${COLOR.white}${userTag}${COLOR.blue} -> "${formattedLeave}" ${COLOR.gray}(${guild.name})`);
			database.logAuditEvent(
				guild.id,
				'VOICE_TTS',
				member.id,
				userTag,
				stamp(`VC Leave Goodbye spoken: "${formattedLeave}"`),
				guild.name
			).catch(() => undefined);
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

const spamTracker = new Map();

async function processAutoMod(message) {
	if (!message.guild || message.author.bot || !message.member) return false;

	if (
		message.member.permissions.has(PermissionFlagsBits.Administrator) ||
		message.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
		message.member.permissions.has(PermissionFlagsBits.ManageMessages) ||
		message.author.id === message.guild.ownerId
	) {
		return false;
	}

	const automod = client.automodConfigs?.get(message.guild.id);
	if (!automod) return false;

	let violationReason = null;

	if (automod.antiinvite_enabled) {
		const inviteRegex = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discord(app)?\.com\/invite)\/[a-zA-Z0-9]+/i;
		if (inviteRegex.test(message.content)) {
			violationReason = 'Posting Discord invite links';
		}
	}

	if (!violationReason && automod.badwords_enabled && Array.isArray(automod.badwords_list) && automod.badwords_list.length > 0) {
		const contentLower = message.content.toLowerCase();
		for (const word of automod.badwords_list) {
			const cleanWord = word.trim().toLowerCase();
			if (cleanWord && contentLower.includes(cleanWord)) {
				violationReason = `Using prohibited keyword: "${cleanWord}"`;
				break;
			}
		}
	}

	if (!violationReason && automod.mention_spam_enabled) {
		const mentionCount = message.mentions.users.size + message.mentions.roles.size;
		if (mentionCount >= 5) {
			violationReason = `Excessive mentions (${mentionCount} mentions)`;
		}
	}

	if (!violationReason && automod.antispam_enabled) {
		const key = `${message.guild.id}:${message.author.id}`;
		const now = Date.now();
		let timestamps = spamTracker.get(key) || [];
		timestamps = timestamps.filter(t => now - t < 3000);
		timestamps.push(now);
		spamTracker.set(key, timestamps);

		if (timestamps.length >= 5) {
			violationReason = 'Rapid message spamming';
			spamTracker.delete(key);
		}
	}

	if (!violationReason) return false;

	try {
		await message.delete().catch(() => undefined);

		const penalty = automod.action || 'delete';
		let penaltyText = 'Message deleted.';

		if (penalty === 'timeout_1m') {
			await message.member.timeout(60 * 1000, `Auto-Mod: ${violationReason}`).catch(() => undefined);
			penaltyText = 'Message deleted & muted for 1 minute.';
		}
		else if (penalty === 'kick') {
			await message.member.kick(`Auto-Mod: ${violationReason}`).catch(() => undefined);
			penaltyText = 'Message deleted & member kicked.';
		}

		BotLogs(message.guild.name, `${COLOR.red}Auto-Mod Action: ${message.author.tag} [${violationReason}] -> ${penaltyText}`);

		database.logAuditEvent(
			message.guild.id,
			'AUTOMOD',
			message.author.id,
			message.author.tag || message.author.username,
			`${violationReason} (${penaltyText})`,
			message.guild.name
		).catch(() => undefined);

		const warnMsg = await message.channel.send({
			content: `⚠️ **Auto-Moderation Warning:** <@${message.author.id}> — ${violationReason}. (${penaltyText})`,
		}).catch(() => undefined);

		if (warnMsg) {
			setTimeout(() => warnMsg.delete().catch(() => undefined), 6000);
		}

		return true;
	}
	catch (error) {
		BotLogs(message.guild.name, `${COLOR.red}Error executing Auto-Mod penalty: ${error.toString()}`);
		return true;
	}
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

			database.logAuditEvent(
				message.guild.id,
				'HONEYPOT',
				message.author.id,
				message.author.tag || message.author.username,
				`Banned for sending message in decoy channel <#${message.channel.id}>`,
				message.guild.name
			).catch(() => undefined);

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

	if (await processAutoMod(message)) return;

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

		const ttsEngine = (await database.getGuildVar(message.guild.id, 'tts_engine')) || 'EDGE_TTS';
		const ttsLang = (await database.getGuildVar(message.guild.id, 'tts_lang')) || 'th';
		const ttsVoice = (await database.getGuildVar(message.guild.id, 'tts_voice')) || 'th-TH-NiwatNeural';
		const ttsIgnorePrefix = (await database.getGuildVar(message.guild.id, 'tts_ignore_prefix')) !== false;
		const ttsMaxLength = parseInt((await database.getGuildVar(message.guild.id, 'tts_max_length')) || 200, 10);
		const antispamEnabled = (await database.getGuildVar(message.guild.id, 'tts_antispam_enabled')) !== false;
		const antispamMaxMessages = parseInt((await database.getGuildVar(message.guild.id, 'tts_antispam_max_messages')) || 3, 10);
		const antispamCooldownSeconds = parseInt((await database.getGuildVar(message.guild.id, 'tts_antispam_cooldown_seconds')) || 30, 10);

		let cleanText = message.content.trim();
		if (cleanText.length === 0) return;

		if (ttsIgnorePrefix && /^[!./\$-?]/i.test(cleanText)) {
			return;
		}

		if (antispamEnabled) {
			const userKey = `${message.guild.id}_${message.author.id}`;
			const now = Date.now();
			const cooldownMs = antispamCooldownSeconds * 1000;

			let history = userTtsHistoryMap.get(userKey) || [];
			history = history.filter(ts => now - ts < cooldownMs);

			if (history.length >= antispamMaxMessages) {
				BotLogs('Tts', `${COLOR.yellow}TTS anti-spam rate limit triggered for ${message.author.username} in ${message.guild.name}`);
				message.reply(`⚠️ <@${message.author.id}> You are sending TTS messages too quickly! Please wait before sending more.`)
					.then(warnMsg => {
						setTimeout(() => warnMsg.delete().catch(() => undefined), 5000);
					})
					.catch(() => undefined);
				return;
			}

			history.push(now);
			userTtsHistoryMap.set(userKey, history);
		}

		// Clean mentions, URLs, custom emojis, and SSML XML tags so numbers and text parse cleanly
		cleanText = cleanText
			.replace(/<@!?(\d+)>/g, (m, uId) => {
				const mem = message.guild?.members.cache.get(uId);
				return mem ? `@${mem.displayName}` : '';
			})
			.replace(/<#(\d+)>/g, (m, cId) => {
				const ch = message.guild?.channels.cache.get(cId);
				return ch ? `#${ch.name}` : '';
			})
			.replace(/<@&(\d+)>/g, (m, rId) => {
				const r = message.guild?.roles.cache.get(rId);
				return r ? `@${r.name}` : '';
			})
			.replace(/<a?:(\w+):\d+>/g, '$1')
			.replace(/https?:\/\/\S+/gi, 'ลิงก์')
			.replace(/[<>]/g, '')
			.trim();

		if (cleanText.length === 0) return;
		if (cleanText.length > ttsMaxLength) {
			cleanText = cleanText.substring(0, ttsMaxLength);
		}

		const { addToQueue, generateUUID } = require('./audio_queue.js');
		const type = ttsEngine === 'GOOGLE_TTS' ? 'GOOGLE_TTS' : 'TTS';

		const entry = {
			uuid: generateUUID(),
			name: cleanText,
			lang: ttsLang,
			voice: ttsVoice,
			type: type,
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
	const isBot = member.user.bot;

	try {
		let roleIdsToAssign = [];
		if (isBot) {
			const botRoles = await database.getGuildVar(guildId, 'bot_autorole_ids');
			if (Array.isArray(botRoles)) roleIdsToAssign = botRoles;
		}
		else {
			const humanRoles = await database.getGuildVar(guildId, 'autorole_ids');
			const legacyRole = await database.getGuildVar(guildId, 'autorole_id');
			if (Array.isArray(humanRoles) && humanRoles.length > 0) {
				roleIdsToAssign = humanRoles;
			}
			else if (legacyRole) {
				roleIdsToAssign = [legacyRole];
			}
		}

		if (roleIdsToAssign.length > 0) {
			const botMember = member.guild.members.me;
			const validRoles = [];

			for (const rId of roleIdsToAssign) {
				const role = member.guild.roles.cache.get(rId);
				if (role && botMember && botMember.permissions.has(PermissionFlagsBits.ManageRoles) && botMember.roles.highest.position > role.position) {
					validRoles.push(role);
				}
			}

			if (validRoles.length > 0) {
				await member.roles.add(validRoles);
				const roleNames = validRoles.map(r => r.name).join(', ');
				BotLogs(member.guild.name, `${COLOR.green}Auto-role assigned (${isBot ? 'Bot' : 'Human'}): added [${COLOR.white}${roleNames}${COLOR.green}] to ${COLOR.white}${member.user.tag}`);

				database.logAuditEvent(
					guildId,
					'AUTOROLE',
					member.id,
					member.user.tag || member.user.username,
					`Assigned ${validRoles.length} auto-role(s) to ${isBot ? 'Bot' : 'Human'}: ${roleNames}`,
					member.guild.name
				).catch(() => undefined);
			}
		}
	}
	catch (error) {
		BotLogs(member.guild.name, `${COLOR.red}Error executing auto-role for ${member.user.tag}: ${error.toString()}`);
	}

	try {
		const welcomeChannelId = await database.getGuildVar(guildId, 'welcome_channel_id');
		const welcomeMode = (await database.getGuildVar(guildId, 'welcome_mode')) || 'text';
		const rawWelcomeEmbed = await database.getGuildVar(guildId, 'welcome_embed');
		const template = await database.getGuildVar(guildId, 'welcome_message_template');

		if (welcomeChannelId) {
			const channel = member.guild.channels.cache.get(welcomeChannelId);
			if (channel && channel.isTextBased()) {
				if (welcomeMode === 'embed' && rawWelcomeEmbed) {
					try {
						const embedConfig = typeof rawWelcomeEmbed === 'string' ? JSON.parse(rawWelcomeEmbed) : rawWelcomeEmbed;
						const embed = buildWelcomeLeaveEmbed(embedConfig, member, member.guild);
						if (embed) {
							await channel.send({ embeds: [embed] });
							BotLogs(member.guild.name, `${COLOR.green}Welcome embed sent to channel ${COLOR.white}#${channel.name}${COLOR.green} for user ${COLOR.white}${member.user ? member.user.tag : member.id}`);
						}
					} catch (e) {
						BotLogs(member.guild.name, `${COLOR.red}Error parsing welcome embed config: ${e.message}`);
					}
				} else if (template) {
					const formattedMessage = renderMemberTemplate(template, member, member.guild);
					await channel.send(formattedMessage);
					BotLogs(member.guild.name, `${COLOR.green}Welcome message sent to channel ${COLOR.white}#${channel.name}${COLOR.green} for user ${COLOR.white}${member.user ? member.user.tag : member.id}`);
				}
			}
		}
	}
	catch (error) {
		BotLogs(member.guild.name, `${COLOR.red}Error executing welcome message for ${member.user ? member.user.tag : member.id}: ${error.toString()}`);
	}
});

function renderMemberTemplate(str, member, guild) {
	if (!str || typeof str !== 'string') return '';
	const user = member?.user || {};
	const username = user.username || member?.id || 'Unknown';
	const displayName = member?.displayName || user.globalName || user.username || username;
	const nickname = member?.nickname || displayName;
	const avatarUrl = (typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL({ size: 256 }) : '') || '';

	return str
		.replace(/\{member\}/g, `<@${member.id}>`)
		.replace(/\{user\}/g, `<@${member.id}>`)
		.replace(/\{username\}/g, username)
		.replace(/\{displayname\}/g, displayName)
		.replace(/\{displayName\}/g, displayName)
		.replace(/\{nickname\}/g, nickname)
		.replace(/\{server\}/g, guild?.name || '')
		.replace(/\{servername\}/g, guild?.name || '')
		.replace(/\{membercount\}/g, String(guild?.memberCount || ''))
		.replace(/\{avatar\}/g, avatarUrl)
		.replace(/\{avatarUrl\}/g, avatarUrl);
}

function buildWelcomeLeaveEmbed(embedConfig, member, guild) {
	if (!embedConfig || typeof embedConfig !== 'object') return null;
	const embed = new EmbedBuilder();
	let hasContent = false;

	if (embedConfig.title) {
		embed.setTitle(renderMemberTemplate(embedConfig.title, member, guild));
		hasContent = true;
	}
	if (embedConfig.titleUrl || embedConfig.url) {
		embed.setURL(renderMemberTemplate(embedConfig.titleUrl || embedConfig.url, member, guild));
	}
	if (embedConfig.description) {
		embed.setDescription(renderMemberTemplate(embedConfig.description, member, guild));
		hasContent = true;
	}
	if (embedConfig.color) {
		embed.setColor(embedConfig.color);
	}
	if (embedConfig.thumbnailUrl) {
		const thumb = renderMemberTemplate(embedConfig.thumbnailUrl, member, guild);
		if (thumb.startsWith('http://') || thumb.startsWith('https://')) {
			embed.setThumbnail(thumb);
			hasContent = true;
		}
	}
	if (embedConfig.imageUrl) {
		const img = renderMemberTemplate(embedConfig.imageUrl, member, guild);
		if (img.startsWith('http://') || img.startsWith('https://')) {
			embed.setImage(img);
			hasContent = true;
		}
	}
	if (embedConfig.authorName) {
		embed.setAuthor({
			name: renderMemberTemplate(embedConfig.authorName, member, guild),
			iconURL: embedConfig.authorIconUrl ? renderMemberTemplate(embedConfig.authorIconUrl, member, guild) : undefined,
			url: embedConfig.authorUrl ? renderMemberTemplate(embedConfig.authorUrl, member, guild) : undefined,
		});
		hasContent = true;
	}
	if (embedConfig.footerText) {
		embed.setFooter({
			text: renderMemberTemplate(embedConfig.footerText, member, guild),
			iconURL: embedConfig.footerIconUrl ? renderMemberTemplate(embedConfig.footerIconUrl, member, guild) : undefined,
		});
		hasContent = true;
	}
	if (embedConfig.includeTimestamp || embedConfig.timestamp) {
		embed.setTimestamp();
	}
	if (Array.isArray(embedConfig.fields) && embedConfig.fields.length > 0) {
		const fields = embedConfig.fields
			.filter(f => f && (f.name || f.value))
			.map(f => ({
				name: renderMemberTemplate(f.name || '\u200b', member, guild),
				value: renderMemberTemplate(f.value || '\u200b', member, guild),
				inline: !!f.inline,
			}));
		if (fields.length > 0) {
			embed.addFields(fields);
			hasContent = true;
		}
	}

	return hasContent ? embed : null;
}

client.on(Events.GuildMemberRemove, async (member) => {
	const guildId = member.guild.id;

	try {
		// Check if user was kicked by a moderator (rate-limited and permission-checked)
		const entry = await fetchAuditLogSafe(member.guild, AuditLogEvent.MemberKick, 4000);
		if (entry && entry.targetId === member.id && Date.now() - entry.createdTimestamp < 4000) {
			const actor = entry.executor ? entry.executor.username : 'Moderator';
			const actorId = entry.executor ? entry.executor.id : null;
			const reason = entry.reason ? ` Reason: ${entry.reason}` : '';
			await database.logAuditEvent(guildId, 'MEMBER_KICK', actorId, actor, `Kicked member @${member.user ? member.user.username : member.id} (${member.id}).${reason}`, member.guild.name);
		} else {
			await database.logAuditEvent(guildId, 'WELCOME_LEAVE', member.id, member.user ? member.user.username : 'User', `Member @${member.user ? member.user.username : member.id} left the server.`, member.guild.name);
		}

		const leaveChannelId = await database.getGuildVar(guildId, 'leave_channel_id');
		const leaveMode = (await database.getGuildVar(guildId, 'leave_mode')) || 'text';
		const rawLeaveEmbed = await database.getGuildVar(guildId, 'leave_embed');
		const template = await database.getGuildVar(guildId, 'leave_message_template');

		if (leaveChannelId) {
			const channel = member.guild.channels.cache.get(leaveChannelId);
			if (channel && channel.isTextBased()) {
				if (leaveMode === 'embed' && rawLeaveEmbed) {
					try {
						const embedConfig = typeof rawLeaveEmbed === 'string' ? JSON.parse(rawLeaveEmbed) : rawLeaveEmbed;
						const embed = buildWelcomeLeaveEmbed(embedConfig, member, member.guild);
						if (embed) {
							await channel.send({ embeds: [embed] });
							BotLogs(member.guild.name, `${COLOR.green}Leave embed sent to channel ${COLOR.white}#${channel.name}${COLOR.green} for user ${COLOR.white}${member.user ? member.user.tag : member.id}`);
						}
					} catch (e) {
						BotLogs(member.guild.name, `${COLOR.red}Error parsing leave embed config: ${e.message}`);
					}
				} else if (template) {
					const formattedMessage = renderMemberTemplate(template, member, member.guild);
					await channel.send(formattedMessage);
					BotLogs(member.guild.name, `${COLOR.green}Leave message sent to channel ${COLOR.white}#${channel.name}${COLOR.green} for user ${COLOR.white}${member.user ? member.user.tag : member.id}`);
				}
			}
		}
	}
	catch (error) {
		BotLogs(member.guild.name, `${COLOR.red}Error executing leave message for ${member.user ? member.user.tag : member.id}: ${error.toString()}`);
	}
});

// =========================================================================
// --- DISCORD NATIVE AUDIT & MODERATION LOGGING SUITE ---
// =========================================================================

const auditLogCooldownMap = new Map();

/**
 * Who did this, asked as rarely as possible and never while we are blocked.
 *
 * Nearly every moderation event wants the same answer, and a busy server fires
 * several of them at once — a ban is a MemberBanAdd and a GuildMemberRemove,
 * a purge is one MessageBulkDelete behind however many MessageDeletes. Asking
 * per event turned one moderator action into a burst on a per-guild bucket.
 *
 * Three things keep that down, in the order that costs least:
 *
 *   1. No ViewAuditLog permission means the request would 403. Do not send it.
 *   2. A 3.5s window per (guild, type) answers the burst from one reply. The
 *      cached entry is only handed back if it is still inside the caller's
 *      `maxAgeMs`, so a stale actor is never attributed to a new event.
 *   3. `discordCall` skips the call outright while blocked and hands failures
 *      to the guard.
 *
 * That last one is why the fetch is not written `.catch(() => null)`. A
 * swallowed failure is a missing guard: it reads as "no audit entry, carry on"
 * and the next event asks again, which is how a block gets extended rather
 * than noticed. Discarding the *result* is fine; discarding the *refusal* is
 * what DISCORD-RATE-LIMITS.md rule 3 is about.
 */
async function fetchAuditLogSafe(guild, type, maxAgeMs = 5000) {
	if (!guild) return null;
	const botMember = guild.members.me;
	if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
		return null;
	}
	const key = `${guild.id}:${type}`;
	const now = Date.now();
	const last = auditLogCooldownMap.get(key);
	if (last && (now - last.timestamp < 3500)) {
		return (last.entry && (now - (last.entry.createdTimestamp || last.timestamp) < maxAgeMs)) ? last.entry : null;
	}

	const auditLogs = await guardedAuditLogs(guild, { limit: 1, type });
	const entry = auditLogs?.entries?.first() || null;
	// Only remember a real answer. Caching the null a block produced would keep
	// answering "nobody did this" for 3.5 seconds after the block clears.
	if (auditLogs) auditLogCooldownMap.set(key, { timestamp: now, entry });
	return entry;
}

// 1. Message Deleted
client.on(Events.MessageDelete, async (message) => {
	if (!message.guild || message.author?.id === client.user?.id) return;
	try {
		const guild = message.guild;
		const channelName = message.channel ? `#${message.channel.name}` : 'unknown channel';
		const authorTag = message.author ? message.author.username : 'Unknown User';
		const authorId = message.author ? message.author.id : null;

		let contentSnippet = message.content ? `"${message.content.substring(0, 150)}${message.content.length > 150 ? '...' : ''}"` : '[No text content]';
		if (message.attachments && message.attachments.size > 0) {
			contentSnippet += ` (+${message.attachments.size} attachment${message.attachments.size > 1 ? 's' : ''})`;
		}

		let executorName = authorTag;
		let executorId = authorId;

		const entry = await fetchAuditLogSafe(guild, AuditLogEvent.MessageDelete, 3500);
		if (entry && entry.targetId === authorId && Date.now() - entry.createdTimestamp < 3500) {
			executorName = entry.executor ? entry.executor.username : 'Moderator';
			executorId = entry.executor ? entry.executor.id : null;
		}

		const detailStr = executorName !== authorTag
			? `Moderator @${executorName} deleted message by @${authorTag} in ${channelName}: ${contentSnippet}`
			: `Message by @${authorTag} deleted in ${channelName}: ${contentSnippet}`;

		await database.logAuditEvent(guild.id, 'MESSAGE_DELETE', executorId, executorName, detailStr, guild.name);
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on MessageDelete: ${err.message}`);
	}
});

// 2. Message Bulk Purged
client.on(Events.MessageBulkDelete, async (messages, channel) => {
	if (!channel.guild) return;
	try {
		const guild = channel.guild;
		const entry = await fetchAuditLogSafe(guild, AuditLogEvent.MessageBulkDelete, 4000);
		const actor = entry?.executor?.username || 'Moderator';
		const actorId = entry?.executor?.id || null;

		await database.logAuditEvent(
			guild.id,
			'MESSAGE_DELETE',
			actorId,
			actor,
			`Bulk purged ${messages.size} messages in #${channel.name}`,
			guild.name
		);
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on MessageBulkDelete: ${err.message}`);
	}
});

// 3. Invite Created
client.on(Events.InviteCreate, async (invite) => {
	if (!invite.guild) return;
	try {
		const guild = invite.guild;
		const inviterName = invite.inviter ? invite.inviter.username : 'Unknown';
		const inviterId = invite.inviter ? invite.inviter.id : null;
		const channelName = invite.channel ? `#${invite.channel.name}` : 'server';
		const uses = invite.maxUses ? `${invite.maxUses} uses` : 'Unlimited uses';
		const expiry = invite.maxAge ? `${invite.maxAge}s` : 'Never expires';

		await database.logAuditEvent(
			guild.id,
			'INVITE_CREATE',
			inviterId,
			inviterName,
			`Created invite link discord.gg/${invite.code} for ${channelName} (Limit: ${uses}, Expiry: ${expiry})`,
			guild.name
		);
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on InviteCreate: ${err.message}`);
	}
});

// 4. Invite Deleted
client.on(Events.InviteDelete, async (invite) => {
	if (!invite.guild) return;
	try {
		const guild = invite.guild;
		const channelName = invite.channel ? `#${invite.channel.name}` : 'server';

		await database.logAuditEvent(
			guild.id,
			'INVITE_DELETE',
			null,
			'Moderator/System',
			`Invite link discord.gg/${invite.code} expired or was deleted for ${channelName}`,
			guild.name
		);
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on InviteDelete: ${err.message}`);
	}
});

// 5. Member Banned
client.on(Events.GuildBanAdd, async (ban) => {
	try {
		const guild = ban.guild;
		const entry = await fetchAuditLogSafe(guild, AuditLogEvent.MemberBanAdd, 4000);
		const actor = (entry && entry.targetId === ban.user.id && Date.now() - entry.createdTimestamp < 4000)
			? entry.executor?.username || 'Moderator'
			: 'Moderator';
		const actorId = entry?.executor?.id || null;
		const reason = ban.reason || entry?.reason || 'No reason provided';

		await database.logAuditEvent(
			guild.id,
			'MEMBER_BAN',
			actorId,
			actor,
			`Banned user @${ban.user.username} (${ban.user.id}). Reason: ${reason}`,
			guild.name
		);
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on GuildBanAdd: ${err.message}`);
	}
});

// 6. Member Unbanned
client.on(Events.GuildBanRemove, async (ban) => {
	try {
		const guild = ban.guild;
		const entry = await fetchAuditLogSafe(guild, AuditLogEvent.MemberBanRemove, 4000);
		const actor = (entry && entry.targetId === ban.user.id && Date.now() - entry.createdTimestamp < 4000)
			? entry.executor?.username || 'Moderator'
			: 'Moderator';
		const actorId = entry?.executor?.id || null;

		await database.logAuditEvent(
			guild.id,
			'MEMBER_UNBAN',
			actorId,
			actor,
			`Unbanned user @${ban.user.username} (${ban.user.id})`,
			guild.name
		);
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on GuildBanRemove: ${err.message}`);
	}
});

// 7. Member Updated (Timeout, Nickname, Roles)
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
	try {
		const guild = newMember.guild;

		// A. Timeout Added
		if (!oldMember.isCommunicationDisabled() && newMember.isCommunicationDisabled()) {
			const entry = await fetchAuditLogSafe(guild, AuditLogEvent.MemberUpdate, 4000);
			const actor = (entry && entry.targetId === newMember.id && Date.now() - entry.createdTimestamp < 4000)
				? entry.executor?.username || 'Moderator'
				: 'Moderator';
			const actorId = entry?.executor?.id || null;
			const until = newMember.communicationDisabledUntil ? new Date(newMember.communicationDisabledUntil).toLocaleString() : 'active duration';
			const reason = entry?.reason ? ` (Reason: ${entry.reason})` : '';

			await database.logAuditEvent(
				guild.id,
				'MEMBER_TIMEOUT',
				actorId,
				actor,
				`Timed out user @${newMember.user.username} until ${until}${reason}`,
				guild.name
			);
		}
		// B. Timeout Removed
		else if (oldMember.isCommunicationDisabled() && !newMember.isCommunicationDisabled()) {
			await database.logAuditEvent(
				guild.id,
				'MEMBER_TIMEOUT',
				null,
				'Moderator',
				`Removed timeout restriction for user @${newMember.user.username}`,
				guild.name
			);
		}

		// C. Nickname Changed
		if (oldMember.nickname !== newMember.nickname) {
			const oldNick = oldMember.nickname || oldMember.user.displayName || oldMember.user.username;
			const newNick = newMember.nickname || newMember.user.displayName || newMember.user.username;

			await database.logAuditEvent(
				guild.id,
				'MEMBER_UPDATE',
				newMember.id,
				newMember.user.username,
				`Nickname changed from "${oldNick}" to "${newNick}"`,
				guild.name
			);
		}

		// D. Native Discord Role Assignment / Removal
		const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id) && r.id !== guild.id);
		const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id) && r.id !== guild.id);

		if (addedRoles.size > 0 || removedRoles.size > 0) {
			const diffParts = [];
			if (addedRoles.size > 0) diffParts.push(`+Added: ${addedRoles.map(r => '@' + r.name).join(', ')}`);
			if (removedRoles.size > 0) diffParts.push(`-Removed: ${removedRoles.map(r => '@' + r.name).join(', ')}`);

			const entry = await fetchAuditLogSafe(guild, AuditLogEvent.MemberRoleUpdate, 4000);
			const actor = (entry && entry.targetId === newMember.id && Date.now() - entry.createdTimestamp < 4000)
				? entry.executor?.username || 'Administrator'
				: 'Administrator';
			const actorId = entry?.executor?.id || null;

			await database.logAuditEvent(
				guild.id,
				'ROLE_ASSIGN',
				actorId,
				actor,
				`Roles updated for @${newMember.user.username}: ${diffParts.join(' | ')}`,
				guild.name
			);
		}
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on GuildMemberUpdate: ${err.message}`);
	}
});

// 8. Channel Created
client.on(Events.ChannelCreate, async (channel) => {
	if (!channel.guild) return;
	try {
		const guild = channel.guild;
		const entry = await fetchAuditLogSafe(guild, AuditLogEvent.ChannelCreate, 4000);
		const actor = (entry && entry.targetId === channel.id && Date.now() - entry.createdTimestamp < 4000)
			? entry.executor?.username || 'Administrator'
			: 'Administrator';
		const actorId = entry?.executor?.id || null;
		const channelType = channel.type === 2 ? 'Voice' : channel.type === 4 ? 'Category' : 'Text';

		await database.logAuditEvent(
			guild.id,
			'CHANNEL_CREATE',
			actorId,
			actor,
			`Created ${channelType} channel #${channel.name}`,
			guild.name
		);
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on ChannelCreate: ${err.message}`);
	}
});

// 9. Channel Deleted
client.on(Events.ChannelDelete, async (channel) => {
	if (!channel.guild) return;
	try {
		const guild = channel.guild;
		const entry = await fetchAuditLogSafe(guild, AuditLogEvent.ChannelDelete, 4000);
		const actor = (entry && entry.targetId === channel.id && Date.now() - entry.createdTimestamp < 4000)
			? entry.executor?.username || 'Administrator'
			: 'Administrator';
		const actorId = entry?.executor?.id || null;

		await database.logAuditEvent(
			guild.id,
			'CHANNEL_DELETE',
			actorId,
			actor,
			`Deleted channel #${channel.name}`,
			guild.name
		);
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on ChannelDelete: ${err.message}`);
	}
});

// 10. Channel Updated
client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
	if (!newChannel.guild) return;
	try {
		const guild = newChannel.guild;
		const changes = [];
		if (oldChannel.name !== newChannel.name) {
			changes.push(`Name: #${oldChannel.name} → #${newChannel.name}`);
		}
		if (oldChannel.topic !== newChannel.topic) {
			changes.push(`Topic updated`);
		}
		if (oldChannel.nsfw !== newChannel.nsfw) {
			changes.push(`NSFW: ${newChannel.nsfw ? 'Enabled' : 'Disabled'}`);
		}

		if (changes.length > 0) {
			const entry = await fetchAuditLogSafe(guild, AuditLogEvent.ChannelUpdate, 4000);
			const actor = (entry && entry.targetId === newChannel.id && Date.now() - entry.createdTimestamp < 4000)
				? entry.executor?.username || 'Administrator'
				: 'Administrator';
			const actorId = entry?.executor?.id || null;

			await database.logAuditEvent(
				guild.id,
				'CHANNEL_UPDATE',
				actorId,
				actor,
				`Updated channel #${newChannel.name}: ${changes.join(', ')}`,
				guild.name
			);
		}
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on ChannelUpdate: ${err.message}`);
	}
});

// 11. Role Created
client.on(Events.GuildRoleCreate, async (role) => {
	try {
		const guild = role.guild;
		const entry = await fetchAuditLogSafe(guild, AuditLogEvent.RoleCreate, 4000);
		const actor = (entry && entry.targetId === role.id && Date.now() - entry.createdTimestamp < 4000)
			? entry.executor?.username || 'Administrator'
			: 'Administrator';
		const actorId = entry?.executor?.id || null;

		await database.logAuditEvent(
			guild.id,
			'ROLE_CREATE',
			actorId,
			actor,
			`Created role @${role.name}`,
			guild.name
		);
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on GuildRoleCreate: ${err.message}`);
	}
});

// 12. Role Deleted
client.on(Events.GuildRoleDelete, async (role) => {
	try {
		const guild = role.guild;
		const entry = await fetchAuditLogSafe(guild, AuditLogEvent.RoleDelete, 4000);
		const actor = (entry && entry.targetId === role.id && Date.now() - entry.createdTimestamp < 4000)
			? entry.executor?.username || 'Administrator'
			: 'Administrator';
		const actorId = entry?.executor?.id || null;

		await database.logAuditEvent(
			guild.id,
			'ROLE_DELETE',
			actorId,
			actor,
			`Deleted role @${role.name}`,
			guild.name
		);
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on GuildRoleDelete: ${err.message}`);
	}
});

// 13. Role Updated
client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
	try {
		const guild = newRole.guild;
		const changes = [];
		if (oldRole.name !== newRole.name) {
			changes.push(`Name: "@${oldRole.name}" → "@${newRole.name}"`);
		}
		if (oldRole.hexColor !== newRole.hexColor) {
			changes.push(`Color: ${oldRole.hexColor} → ${newRole.hexColor}`);
		}
		if (oldRole.hoist !== newRole.hoist) {
			changes.push(`Hoist: ${newRole.hoist ? 'Enabled' : 'Disabled'}`);
		}
		if (oldRole.mentionable !== newRole.mentionable) {
			changes.push(`Mentionable: ${newRole.mentionable ? 'Enabled' : 'Disabled'}`);
		}

		if (changes.length > 0) {
			const entry = await fetchAuditLogSafe(guild, AuditLogEvent.RoleUpdate, 4000);
			const actor = (entry && entry.targetId === newRole.id && Date.now() - entry.createdTimestamp < 4000)
				? entry.executor?.username || 'Administrator'
				: 'Administrator';
			const actorId = entry?.executor?.id || null;

			await database.logAuditEvent(
				guild.id,
				'ROLE_UPDATE',
				actorId,
				actor,
				`Updated role @${newRole.name}: ${changes.join(', ')}`,
				guild.name
			);
		}
	} catch (err) {
		BotLogs('SYSTEM', `Audit error on GuildRoleUpdate: ${err.message}`);
	}
});



client.on(Events.MessageReactionAdd, async (reaction, user) => {
	if (user.bot) return;
	const guildId = reaction.message.guildId || reaction.message.guild?.id;
	if (!guildId) return;

	const messageId = reaction.message.id;
	const emojiKey = reaction.emoji.id || reaction.emoji.name;

	try {
		// 1. Fast check: Only query Discord REST if this message actually has reaction roles
		const rawMap = await database.getGuildVar(guildId, 'reaction_roles');
		const mappings = parseReactionRolesMap(rawMap);
		const messageMappings = mappings[messageId];
		if (!messageMappings || !messageMappings[emojiKey]) return;

		const mapEntry = messageMappings[emojiKey];
		if (typeof mapEntry === 'object' && mapEntry.enabled === false) {
			return; // Ignore disabled reaction role mapping
		}
		const roleId = typeof mapEntry === 'object' ? mapEntry.roleId : mapEntry;

		// 2. Fetch partials only when confirmed valid
		if (reaction.partial) {
			await discordCall('resolving a partial reaction', () => reaction.fetch(), null);
		}
		if (reaction.message && reaction.message.partial) {
			await discordCall('resolving a partial reaction message', () => reaction.message.fetch(), null);
		}

		const guild = reaction.message.guild || client.guilds.cache.get(guildId);
		if (!guild) return;

		const role = guild.roles.cache.get(roleId);
		if (role) {
			// Cache first, because a member already on the gateway costs nothing.
			// The fetch behind it is a real request, so it goes through the guard
			// rather than a .catch that would hide a refusal from it.
			const member = guild.members.cache.get(user.id)
				|| await discordCall('fetching a reaction member', () => guild.members.fetch(user.id), null);
			if (member) {
				const botMember = guild.members.me;
				if (botMember && botMember.permissions.has(PermissionFlagsBits.ManageRoles) && botMember.roles.highest.position > role.position) {
					await member.roles.add(role);
					BotLogs(guild.name, `${COLOR.green}Reaction role assigned: added ${COLOR.white}${role.name}${COLOR.green} to user ${COLOR.white}${user.tag || user.username} for emoji ${COLOR.white}${reaction.emoji.name}`);
					
					database.logAuditEvent(
						guildId,
						'REACTION_ROLE',
						user.id,
						user.tag || user.username,
						`Added role @${role.name} via reaction ${reaction.emoji.name}`,
						guild.name
					).catch(() => undefined);
				}
				else {
					BotLogs(guild.name, `${COLOR.yellow}Warning: Failed to assign reaction role ${COLOR.white}${role.name}${COLOR.yellow} (missing permissions)`);
				}
			}
		}
	}
	catch (error) {
		BotLogs('SYSTEM', `Error assigning reaction role: ${error.toString()}`);
	}
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
	if (user.bot) return;
	const guildId = reaction.message.guildId || reaction.message.guild?.id;
	if (!guildId) return;

	const messageId = reaction.message.id;
	const emojiKey = reaction.emoji.id || reaction.emoji.name;

	try {
		// 1. Fast check: Only query Discord REST if this message actually has reaction roles
		const rawMap = await database.getGuildVar(guildId, 'reaction_roles');
		const mappings = parseReactionRolesMap(rawMap);
		const messageMappings = mappings[messageId];
		if (!messageMappings || !messageMappings[emojiKey]) return;

		const mapEntry = messageMappings[emojiKey];
		if (typeof mapEntry === 'object' && mapEntry.enabled === false) {
			return; // Ignore disabled reaction role mapping
		}
		const roleId = typeof mapEntry === 'object' ? mapEntry.roleId : mapEntry;
		const mode = typeof mapEntry === 'object' ? (mapEntry.mode || 'toggle') : 'toggle';

		if (mode === 'give_only') {
			return; // Give-only mode preserves role when reaction is removed
		}

		// 2. Fetch partials only when confirmed valid
		if (reaction.partial) {
			await discordCall('resolving a partial reaction', () => reaction.fetch(), null);
		}
		if (reaction.message && reaction.message.partial) {
			await discordCall('resolving a partial reaction message', () => reaction.message.fetch(), null);
		}

		const guild = reaction.message.guild || client.guilds.cache.get(guildId);
		if (!guild) return;

		const role = guild.roles.cache.get(roleId);
		if (role) {
			// Cache first, because a member already on the gateway costs nothing.
			// The fetch behind it is a real request, so it goes through the guard
			// rather than a .catch that would hide a refusal from it.
			const member = guild.members.cache.get(user.id)
				|| await discordCall('fetching a reaction member', () => guild.members.fetch(user.id), null);
			if (member) {
				const botMember = guild.members.me;
				if (botMember && botMember.permissions.has(PermissionFlagsBits.ManageRoles) && botMember.roles.highest.position > role.position) {
					await member.roles.remove(role);
					BotLogs(guild.name, `${COLOR.green}Reaction role removed: took ${COLOR.white}${role.name}${COLOR.green} from user ${COLOR.white}${user.tag || user.username} for emoji ${COLOR.white}${reaction.emoji.name}`);
					
					database.logAuditEvent(
						guildId,
						'REACTION_ROLE',
						user.id,
						user.tag || user.username,
						`Removed role @${role.name} via reaction remove ${reaction.emoji.name}`,
						guild.name
					).catch(() => undefined);
				}
				else {
					BotLogs(guild.name, `${COLOR.yellow}Warning: Failed to remove reaction role ${COLOR.white}${role.name}${COLOR.yellow} (missing permissions)`);
				}
			}
		}
	}
	catch (error) {
		BotLogs('SYSTEM', `Error removing reaction role: ${error.toString()}`);
	}
});

process.on('message', async (msg) => {
	if (!msg) return;

	if (msg.type === 'discord_block') {
		// Another process on this box was refused. The ban is on the IP, so it
		// is ours too — stop now rather than finding out the same way it did.
		if (discordBlock.adopt(msg.untilMs)) {
			BotLogs('SYSTEM', `${COLOR.yellow}Discord is blocking this server's IP (reported elsewhere). Pausing Discord calls for ${Math.round(discordBlock.retryAfterSeconds() / 60)} minutes.`);
		}
		return;
	}

	if (msg.type === 'ping') {
		BotLogs('SYSTEM', `${COLOR.green}Received Ping IPC from Web Server! Bot is alive and responsive! (Ready: ${client.isReady()})`);
	}
	else if (msg.type === 'check_guilds_presence') {
		const presence = {};
		const guildInfo = {};
		if (msg.guildIds && Array.isArray(msg.guildIds)) {
			for (const id of msg.guildIds) {
				const g = client.guilds.cache.get(id);
				presence[id] = !!g;
				if (g) {
					guildInfo[id] = {
						memberCount: g.memberCount,
						banner: g.bannerURL ? g.bannerURL({ size: 512 }) : null,
						splash: g.splashURL ? g.splashURL({ size: 512 }) : null,
						icon: g.iconURL ? g.iconURL({ size: 128 }) : null,
					};
				}
			}
		}
		if (process.send) {
			process.send({ target: 'web', type: 'guilds_presence_response', reqId: msg.reqId, presence, guildInfo });
		}
	}
	else if (msg.type === 'payment_notice') {
		let delivered = 0;
		const recipients = Array.isArray(msg.recipients) ? [...new Set(msg.recipients)] : [];
		const message = String(msg.message || '').slice(0, 1900);
		// Re-checked on every recipient, not once at the top: the first refused
		// DM is how a block announces itself, and the rest of the list must not
		// follow it into the wall.
		for (const discordUid of recipients) {
			if (discordBlock.blocked()) break;
			if (!/^\d{17,20}$/.test(String(discordUid)) || !message) continue;
			const user = await discordCall('opening a DM', () => client.users.fetch(String(discordUid)), null);
			if (user && await discordCall('sending a DM', () => user.send(message).then(() => true), false)) delivered++;
		}
		if (process.send) {
			// `blocked` is read after the loop, so a block that arrives partway
			// through is still reported. The dispatcher leaves the delivery
			// pending on it and retries with backoff, which is the right shape:
			// the notification still goes out, just after the ban.
			process.send({ target: 'web', type: 'payment_notice_response', reqId: msg.reqId, delivered, blocked: discordBlock.blocked() });
		}
	}
	else if (msg.type === 'get_guild_details') {
		const guild = client.guilds.cache.get(msg.guildId);
		if (!guild) {
			if (process.send) {
				process.send({ target: 'web', type: 'guild_details_response', reqId: msg.reqId, exists: false });
			}
			return;
		}

		// The gateway cache first, because it is already in memory and costs
		// Discord nothing. `GET /guilds/{id}/members?limit=1000` is the most
		// expensive thing this bot asks for, and this screen used to ask for it
		// on every page load.
		let members = mapGuildMembers(guild);

		// Only an empty cache — a fresh boot, before the gateway has filled it —
		// is worth a request, and even then a capped one. It goes through the
		// guard, so while Discord is refusing us this returns nothing and the
		// dashboard renders an empty roster instead of holding the block open.
		if (members.length === 0) {
			await discordCall(
				'filling the member cache for the dashboard',
				() => guild.members.fetch({ limit: 100, time: 3000 }),
				null,
			);
			members = mapGuildMembers(guild);
		}

		members.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));

		// Tally role member counts directly from members list
		const roleMemberCounts = new Map();
		for (const member of members) {
			for (const rId of member.roles) {
				roleMemberCounts.set(rId, (roleMemberCounts.get(rId) || 0) + 1);
			}
		}

		const channels = guild.channels.cache
			.filter(c => c.type === 0 || c.type === 2)
			.map(c => ({
				id: c.id,
				name: c.name,
				type: c.type,
				parentName: c.parent ? c.parent.name : 'General Channels',
				position: c.rawPosition || c.position || 0,
			}))
			.sort((a, b) => a.position - b.position);

		const botMember = guild.members.me;
		const botHighestPosition = botMember ? botMember.roles.highest.position : 0;

		const roles = guild.roles.cache
			.map(r => {
				const directCount = roleMemberCounts.get(r.id) || (r.members ? r.members.size : 0);
				return {
					id: r.id,
					name: r.name,
					color: r.color,
					hexColor: r.hexColor,
					hoist: r.hoist,
					mentionable: r.mentionable,
					position: r.position,
					managed: r.managed,
					memberCount: r.name === '@everyone' ? guild.memberCount : directCount,
					canManage: r.name !== '@everyone' && !r.managed && r.position < botHighestPosition,
				};
			})
			.sort((a, b) => b.position - a.position);

		if (process.send) {
			process.send({
				target: 'web',
				type: 'guild_details_response',
				reqId: msg.reqId,
				exists: true,
				name: guild.name,
				channels,
				roles,
				members,
				icon: guild.iconURL(),
			});
		}
	}
	else if (msg.type === 'create_guild_role') {
		try {
			const guild = client.guilds.cache.get(msg.guildId);
			if (!guild) {
				if (process.send) process.send({ target: 'web', type: 'create_role_response', reqId: msg.reqId, success: false, error: 'Server not found.' });
				return;
			}

			const botMember = guild.members.me;
			if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
				if (process.send) process.send({ target: 'web', type: 'create_role_response', reqId: msg.reqId, success: false, error: 'Bot lacks Manage Roles permission in this server.' });
				return;
			}

			const { name, color, hoist, mentionable } = msg.roleData || {};
			const newRole = await guild.roles.create({
				name: name || 'new role',
				color: color || '#99aab5',
				hoist: !!hoist,
				mentionable: !!mentionable,
				reason: `Role created via Web Dashboard by ${msg.actor || 'Administrator'}`,
			});

			BotLogs(guild.name, `${COLOR.green}Created role @${newRole.name} (ID: ${newRole.id}) via Web Dashboard.`);
			if (process.send) {
				process.send({
					target: 'web',
					type: 'create_role_response',
					reqId: msg.reqId,
					success: true,
					role: {
						id: newRole.id,
						name: newRole.name,
						color: newRole.color,
						hexColor: newRole.hexColor,
						hoist: newRole.hoist,
						mentionable: newRole.mentionable,
						position: newRole.position,
						managed: newRole.managed,
						memberCount: 0,
						canManage: true,
					},
				});
			}
		}
		catch (err) {
			BotLogs('SYSTEM', `${COLOR.red}Error creating role: ${err.message}`);
			if (process.send) process.send({ target: 'web', type: 'create_role_response', reqId: msg.reqId, success: false, error: err.message });
		}
	}
	else if (msg.type === 'update_guild_role') {
		try {
			const guild = client.guilds.cache.get(msg.guildId);
			if (!guild) {
				if (process.send) process.send({ target: 'web', type: 'update_role_response', reqId: msg.reqId, success: false, error: 'Server not found.' });
				return;
			}

			const role = guild.roles.cache.get(msg.roleId);
			if (!role) {
				if (process.send) process.send({ target: 'web', type: 'update_role_response', reqId: msg.reqId, success: false, error: 'Role not found.' });
				return;
			}

			if (role.managed) {
				if (process.send) process.send({ target: 'web', type: 'update_role_response', reqId: msg.reqId, success: false, error: 'Managed integration roles cannot be edited.' });
				return;
			}

			const botMember = guild.members.me;
			if (role.position >= botMember.roles.highest.position && guild.ownerId !== client.user.id) {
				if (process.send) process.send({ target: 'web', type: 'update_role_response', reqId: msg.reqId, success: false, error: 'Cannot edit role positioned higher than or equal to bot highest role.' });
				return;
			}

			const { name, color, hoist, mentionable } = msg.roleData || {};
			const editPayload = { reason: `Role updated via Web Dashboard by ${msg.actor || 'Administrator'}` };
			if (name !== undefined && role.name !== '@everyone') editPayload.name = name;
			if (color !== undefined) editPayload.color = color;
			if (hoist !== undefined) editPayload.hoist = !!hoist;
			if (mentionable !== undefined) editPayload.mentionable = !!mentionable;

			const updatedRole = await role.edit(editPayload);
			BotLogs(guild.name, `${COLOR.green}Updated role @${updatedRole.name} (ID: ${updatedRole.id}) via Web Dashboard.`);

			if (process.send) {
				process.send({
					target: 'web',
					type: 'update_role_response',
					reqId: msg.reqId,
					success: true,
					role: {
						id: updatedRole.id,
						name: updatedRole.name,
						color: updatedRole.color,
						hexColor: updatedRole.hexColor,
						hoist: updatedRole.hoist,
						mentionable: updatedRole.mentionable,
						position: updatedRole.position,
						managed: updatedRole.managed,
						memberCount: updatedRole.members.size,
						canManage: true,
					},
				});
			}
		}
		catch (err) {
			BotLogs('SYSTEM', `${COLOR.red}Error updating role: ${err.message}`);
			if (process.send) process.send({ target: 'web', type: 'update_role_response', reqId: msg.reqId, success: false, error: err.message });
		}
	}
	else if (msg.type === 'delete_guild_role') {
		try {
			const guild = client.guilds.cache.get(msg.guildId);
			if (!guild) {
				if (process.send) process.send({ target: 'web', type: 'delete_role_response', reqId: msg.reqId, success: false, error: 'Server not found.' });
				return;
			}

			const role = guild.roles.cache.get(msg.roleId);
			if (!role) {
				if (process.send) process.send({ target: 'web', type: 'delete_role_response', reqId: msg.reqId, success: false, error: 'Role not found.' });
				return;
			}

			if (role.name === '@everyone' || role.managed) {
				if (process.send) process.send({ target: 'web', type: 'delete_role_response', reqId: msg.reqId, success: false, error: 'Cannot delete @everyone or managed integration roles.' });
				return;
			}

			const botMember = guild.members.me;
			if (role.position >= botMember.roles.highest.position) {
				if (process.send) process.send({ target: 'web', type: 'delete_role_response', reqId: msg.reqId, success: false, error: 'Cannot delete role positioned higher than bot role.' });
				return;
			}

			const roleName = role.name;
			await role.delete(`Deleted via Web Dashboard by ${msg.actor || 'Administrator'}`);
			BotLogs(guild.name, `${COLOR.green}Deleted role @${roleName} (ID: ${msg.roleId}) via Web Dashboard.`);

			if (process.send) {
				process.send({
					target: 'web',
					type: 'delete_role_response',
					reqId: msg.reqId,
					success: true,
					roleId: msg.roleId,
					roleName,
				});
			}
		}
		catch (err) {
			BotLogs('SYSTEM', `${COLOR.red}Error deleting role: ${err.message}`);
			if (process.send) process.send({ target: 'web', type: 'delete_role_response', reqId: msg.reqId, success: false, error: err.message });
		}
	}
	else if (msg.type === 'get_guild_members') {
		try {
			const guild = client.guilds.cache.get(msg.guildId);
			if (!guild) {
				if (process.send) process.send({ target: 'web', type: 'get_members_response', reqId: msg.reqId, success: false, error: 'Server not found.' });
				return;
			}

			const queryText = (msg.query || '').trim();

			// Search what is already in memory first. Typing in the Member
			// Manager search box used to mean a request per keystroke-ish
			// refresh, on one of the tightest per-guild buckets there is.
			let members = mapGuildMembers(guild, queryText);

			// Nothing matched in cache. One capped request, through the guard —
			// so a search performed while Discord is refusing us returns empty
			// rather than becoming more traffic against a live block.
			if (members.length === 0) {
				await discordCall(
					'searching server members over the gateway',
					() => (queryText
						? guild.members.fetch({ query: queryText, limit: 50, time: 3000 })
						: guild.members.fetch({ limit: 100, time: 3000 })),
					null,
				);
				members = mapGuildMembers(guild, queryText);
			}

			members.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
			BotLogs(guild.name, `${COLOR.green}Retrieved ${members.length} members for Member Manager.`);

			if (process.send) {
				process.send({
					target: 'web',
					type: 'get_members_response',
					reqId: msg.reqId,
					success: true,
					members,
				});
			}
		}
		catch (err) {
			BotLogs('SYSTEM', `${COLOR.red}Error in get_guild_members: ${err.message}`);
			if (process.send) process.send({ target: 'web', type: 'get_members_response', reqId: msg.reqId, success: false, error: err.message });
		}
	}
	else if (msg.type === 'modify_member_role') {
		try {
			const guild = client.guilds.cache.get(msg.guildId);
			if (!guild) {
				if (process.send) process.send({ target: 'web', type: 'modify_member_role_response', reqId: msg.reqId, success: false, error: 'Server not found.' });
				return;
			}

			const member = await discordCall('fetching a member', () => guild.members.fetch(msg.memberId), null);
			if (!member) {
				if (process.send) process.send({ target: 'web', type: 'modify_member_role_response', reqId: msg.reqId, success: false, error: 'Member not found in server.' });
				return;
			}

			const role = guild.roles.cache.get(msg.roleId);
			if (!role) {
				if (process.send) process.send({ target: 'web', type: 'modify_member_role_response', reqId: msg.reqId, success: false, error: 'Role not found.' });
				return;
			}

			const botMember = guild.members.me;
			if (role.position >= botMember.roles.highest.position) {
				if (process.send) process.send({ target: 'web', type: 'modify_member_role_response', reqId: msg.reqId, success: false, error: 'Cannot modify role positioned higher than bot role.' });
				return;
			}

			if (msg.action === 'add') {
				await member.roles.add(role, `Assigned via Web Dashboard by ${msg.actor || 'Administrator'}`);
				BotLogs(guild.name, `${COLOR.green}Assigned role @${role.name} to member ${member.user.username} via Web Dashboard.`);
			}
			else {
				await member.roles.remove(role, `Removed via Web Dashboard by ${msg.actor || 'Administrator'}`);
				BotLogs(guild.name, `${COLOR.green}Removed role @${role.name} from member ${member.user.username} via Web Dashboard.`);
			}

			if (process.send) {
				process.send({
					target: 'web',
					type: 'modify_member_role_response',
					reqId: msg.reqId,
					success: true,
					memberId: member.id,
					roleId: role.id,
					action: msg.action,
					roles: Array.from(member.roles.cache.keys()).filter(id => id !== guild.id),
				});
			}
		}
		catch (err) {
			BotLogs('SYSTEM', `${COLOR.red}Error modifying member role: ${err.message}`);
			if (process.send) process.send({ target: 'web', type: 'modify_member_role_response', reqId: msg.reqId, success: false, error: err.message });
		}
	}
	else if (msg.type === 'set_member_roles') {
		try {
			const guild = client.guilds.cache.get(msg.guildId);
			if (!guild) {
				if (process.send) process.send({ target: 'web', type: 'set_member_roles_response', reqId: msg.reqId, success: false, error: 'Server not found.' });
				return;
			}

			const member = await discordCall('fetching a member', () => guild.members.fetch(msg.memberId), null);
			if (!member) {
				if (process.send) process.send({ target: 'web', type: 'set_member_roles_response', reqId: msg.reqId, success: false, error: 'Member not found in server.' });
				return;
			}

			const botMember = guild.members.me;
			const botHighest = botMember ? botMember.roles.highest.position : 0;

			// Preserve unmanageable roles (higher than bot or integration-managed)
			const unmanageableRoles = Array.from(member.roles.cache.values())
				.filter(r => r.id !== guild.id && (r.position >= botHighest || r.managed))
				.map(r => r.id);

			// Filter incoming desired roles to valid manageable roles
			const manageableDesired = (Array.isArray(msg.roleIds) ? msg.roleIds : [])
				.filter(rId => {
					const r = guild.roles.cache.get(rId);
					return r && r.id !== guild.id && r.position < botHighest && !r.managed;
				});

			const finalRoleIds = Array.from(new Set([...unmanageableRoles, ...manageableDesired]));

			await member.roles.set(finalRoleIds, `Batch role update via Web Dashboard by ${msg.actor || 'Administrator'}`);
			BotLogs(guild.name, `${COLOR.green}Updated roles for member ${member.user.username} via Web Dashboard (${finalRoleIds.length} active roles).`);

			if (process.send) {
				process.send({
					target: 'web',
					type: 'set_member_roles_response',
					reqId: msg.reqId,
					success: true,
					memberId: member.id,
					roles: Array.from(member.roles.cache.keys()).filter(id => id !== guild.id),
				});
			}
		}
		catch (err) {
			BotLogs('SYSTEM', `${COLOR.red}Error setting member roles: ${err.message}`);
			if (process.send) process.send({ target: 'web', type: 'set_member_roles_response', reqId: msg.reqId, success: false, error: err.message });
		}
	}
	else if (msg.type === 'send_custom_embed') {
		try {
			const guild = client.guilds.cache.get(msg.guildId);
			if (!guild) {
				if (process.send) process.send({ target: 'web', type: 'send_embed_response', reqId: msg.reqId, success: false, error: 'Bot is not in this server.' });
				return;
			}

			const channel = guild.channels.cache.get(msg.channelId);
			if (!channel || !channel.isTextBased()) {
				if (process.send) process.send({ target: 'web', type: 'send_embed_response', reqId: msg.reqId, success: false, error: 'Text channel not found.' });
				return;
			}

			const embedData = msg.embedData || {};
			const embed = new EmbedBuilder();

			if (embedData.title) embed.setTitle(embedData.title);
			if (embedData.titleUrl || embedData.url) embed.setURL(embedData.titleUrl || embedData.url);
			if (embedData.description) embed.setDescription(embedData.description);
			if (embedData.color) embed.setColor(embedData.color);
			if (embedData.imageUrl) embed.setImage(embedData.imageUrl);
			if (embedData.thumbnailUrl) embed.setThumbnail(embedData.thumbnailUrl);
			if (embedData.footerText) {
				embed.setFooter({
					text: embedData.footerText,
					iconURL: embedData.footerIconUrl || undefined,
				});
			}
			if (embedData.authorName) {
				embed.setAuthor({
					name: embedData.authorName,
					iconURL: embedData.authorIconUrl || undefined,
					url: embedData.authorUrl || undefined,
				});
			}
			if (embedData.includeTimestamp || embedData.timestamp) {
				embed.setTimestamp();
			}
			if (Array.isArray(embedData.fields) && embedData.fields.length > 0) {
				const validFields = embedData.fields
					.filter(f => f && f.name && f.value)
					.map(f => ({
						name: String(f.name).slice(0, 256),
						value: String(f.value).slice(0, 1024),
						inline: !!f.inline,
					}));
				if (validFields.length > 0) {
					embed.addFields(validFields);
				}
			}

			await channel.send({ embeds: [embed] });
			BotLogs(guild.name, `${COLOR.green}Sent rich custom embed to channel #${channel.name} via Web Dashboard.`);

			if (process.send) process.send({ target: 'web', type: 'send_embed_response', reqId: msg.reqId, success: true });
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Error sending embed via IPC: ${error.toString()}`);
			if (process.send) process.send({ target: 'web', type: 'send_embed_response', reqId: msg.reqId, success: false, error: error.message });
		}
	}
	else if (msg.type === 'get_bot_stats') {
		const pingMs = Math.round(client.ws.ping || 0);
		const guildsCount = client.guilds.cache.size;
		const usersCount = client.users.cache.size;
		const guilds = client.guilds.cache.map(g => ({
			id: g.id,
			name: g.name,
			memberCount: g.memberCount,
		}));
		const { audioQueueManager } = require('./audio_queue.js');
		const voiceConnectionsCount = audioQueueManager.players ? audioQueueManager.players.size : 0;

		if (process.send) {
			process.send({
				target: 'web',
				type: 'bot_stats_response',
				reqId: msg.reqId,
				exists: true,
				pingMs,
				guildsCount,
				usersCount,
				voiceConnectionsCount,
				readyTimestamp: client.customReadyTimestamp || client.readyTimestamp,
				guilds,
			});
		}
	}
	else if (msg.type === 'get_audio_queues') {
		try {
			const { audioQueueManager } = require('./audio_queue.js');
			const queues = audioQueueManager.getAllQueues();
			if (process.send) {
				process.send({
					target: 'web',
					type: 'get_audio_queues_response',
					reqId: msg.reqId,
					success: true,
					queues,
				});
			}
		}
		catch (err) {
			if (process.send) {
				process.send({
					target: 'web',
					type: 'get_audio_queues_response',
					reqId: msg.reqId,
					success: false,
					error: err.message,
					queues: [],
				});
			}
		}
	}
	else if (msg.type === 'skip_audio_queue') {
		try {
			const { audioQueueManager } = require('./audio_queue.js');
			const result = audioQueueManager.skipCurrent(msg.guildId);
			if (process.send) {
				process.send({
					target: 'web',
					type: 'skip_audio_queue_response',
					reqId: msg.reqId,
					success: result,
				});
			}
		}
		catch (err) {
			if (process.send) {
				process.send({
					target: 'web',
					type: 'skip_audio_queue_response',
					reqId: msg.reqId,
					success: false,
					error: err.message,
				});
			}
		}
	}
	else if (msg.type === 'remove_audio_queue_item') {
		try {
			const { audioQueueManager } = require('./audio_queue.js');
			const result = audioQueueManager.removeItem(msg.guildId, msg.itemId);
			if (process.send) {
				process.send({
					target: 'web',
					type: 'remove_audio_queue_item_response',
					reqId: msg.reqId,
					success: result,
				});
			}
		}
		catch (err) {
			if (process.send) {
				process.send({
					target: 'web',
					type: 'remove_audio_queue_item_response',
					reqId: msg.reqId,
					success: false,
					error: err.message,
				});
			}
		}
	}
	else if (msg.type === 'clear_guild_audio_queue') {
		try {
			const { audioQueueManager } = require('./audio_queue.js');
			audioQueueManager.clearQueue(msg.guildId);
			if (process.send) {
				process.send({
					target: 'web',
					type: 'clear_guild_audio_queue_response',
					reqId: msg.reqId,
					success: true,
				});
			}
		}
		catch (err) {
			if (process.send) {
				process.send({
					target: 'web',
					type: 'clear_guild_audio_queue_response',
					reqId: msg.reqId,
					success: false,
					error: err.message,
				});
			}
		}
	}
	else if (msg.type === 'force_add_audio_queue') {
		try {
			const { addToQueue, audioQueueManager } = require('./audio_queue.js');
			const guild = client.guilds.cache.get(msg.guildId);
			if (!guild) {
				if (process.send) process.send({ target: 'web', type: 'force_add_audio_queue_response', reqId: msg.reqId, success: false, error: 'Server not found or bot not in server.' });
				return;
			}

			// Look for existing active queue connection or join a voice channel
			const existingQueue = audioQueueManager.getQueue(msg.guildId);
			let connection = existingQueue[0]?.connection || null;

			if (!connection) {
				// Search for a voice channel with users or the first accessible voice channel
				const voiceChannels = guild.channels.cache.filter(c => c.type === 2);
				const targetChannel = voiceChannels.find(c => c.members && c.members.size > 0) || voiceChannels.first();

				if (targetChannel) {
					connection = joinVoiceChannel({
						channelId: targetChannel.id,
						guildId: guild.id,
						adapterCreator: guild.voiceAdapterCreator,
					});
				}
			}

			if (!connection) {
				if (process.send) process.send({ target: 'web', type: 'force_add_audio_queue_response', reqId: msg.reqId, success: false, error: 'No active voice connection or voice channel found in server.' });
				return;
			}

			let isSound = false;
			let soundFile = null;
			if (msg.sound) {
				const fs = require('fs');
				const path = require('path');
				const sPath = path.join(__dirname, '../../sounds', `${msg.sound}.mp3`);
				if (fs.existsSync(sPath)) {
					isSound = true;
					soundFile = sPath;
				}
			}

			const options = {
				userName: msg.userName || 'Dashboard Admin',
				engine: isSound ? 'AUDIO_MP3' : (msg.engine || 'EDGE_TTS'),
				type: isSound ? 'AUDIO_MP3' : 'TTS',
				file: soundFile,
				volume: typeof msg.volume === 'number' ? msg.volume : 0.5,
				voice: msg.voice || 'th-TH-NiwatNeural',
				lang: msg.lang || 'th',
			};

			const textOrName = isSound ? msg.sound : (msg.text || 'Sound Clip');
			const result = addToQueue(guild.id, guild.name, connection, textOrName, options);
			if (process.send) {
				process.send({
					target: 'web',
					type: 'force_add_audio_queue_response',
					reqId: msg.reqId,
					success: !!result.id,
					id: result.id,
				});
			}
		}
		catch (err) {
			if (process.send) {
				process.send({
					target: 'web',
					type: 'force_add_audio_queue_response',
					reqId: msg.reqId,
					success: false,
					error: err.message,
				});
			}
		}
	}
	else if (msg.type === 'clear_all_audio_queues') {
		try {
			const { audioQueueManager } = require('./audio_queue.js');
			if (audioQueueManager && audioQueueManager.queues) {
				for (const gId of audioQueueManager.queues.keys()) {
					audioQueueManager.clearQueue(gId);
				}
			}
			if (process.send) process.send({ target: 'web', type: 'clear_all_audio_queues_response', reqId: msg.reqId, success: true });
		}
		catch (err) {
			if (process.send) process.send({ target: 'web', type: 'clear_all_audio_queues_response', reqId: msg.reqId, success: false, error: err.message });
		}
	}
	else if (msg.type === 'reload_guild_cache') {
		try {
			client.honeypots = await database.getAllHoneypots();
			client.ttsChannels = await database.getAllTtsChannels();
			client.automodConfigs = await database.getAllAutoModConfigs();
			BotLogs('SYSTEM', `${COLOR.green}Hot-reloaded honeypots, TTS channels, and Auto-Mod caches via Web Dashboard update.`);
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Error hot-reloading cache: ${error.toString()}`);
		}
	}
	else if (msg.type === 'restart_bot') {
		BotLogs('SYSTEM', `${COLOR.yellow}Received restart request via Developer Web Console. Exiting process for clean supervisor restart...`);
		try {
			if (client) client.destroy();
		}
		catch {}
		setTimeout(() => process.exit(0), 500);
	}
	else if (msg.type === 'add_reaction_role_react') {
		const { guildId, channelId, messageId, emoji } = msg;
		const guild = client.guilds.cache.get(guildId);
		if (guild) {
			try {
				let channel = channelId ? guild.channels.cache.get(channelId) : null;
				if (!channel) {
					// No channel id, so the message has to be hunted for — one
					// request per text channel, as fast as the loop can issue
					// them. On a large server that is a burst of a hundred
					// requests for a single reaction-role setup, which is the
					// exact shape that earns a 429 and then a block.
					//
					// The cap bounds the burst, and stopping the moment we are
					// refused stops it being a burst into a closed door. Pasting
					// the full message link on the web side supplies the channel
					// id and skips all of this.
					const SEARCH_LIMIT = 25;
					const textChannels = [...guild.channels.cache.filter(c => c.type === 0).values()];
					if (textChannels.length > SEARCH_LIMIT) {
						BotLogs(guild.name, `${COLOR.yellow}Searching only the first ${SEARCH_LIMIT} of ${textChannels.length} text channels for message ${messageId}. Paste the message link to name the channel directly.`);
					}

					for (const ch of textChannels.slice(0, SEARCH_LIMIT)) {
						if (discordBlock.blocked()) break;
						const targetMsg = await discordCall('fetching a reaction-role message', () => ch.messages.fetch(messageId));
						if (targetMsg) {
							channel = ch;
							break;
						}
					}
				}
				if (channel) {
					const targetMsg = await discordCall('fetching a reaction-role message', () => channel.messages.fetch(messageId));
					if (targetMsg) {
						await discordCall('adding a reaction-role reaction', () => targetMsg.react(emoji));
						BotLogs(guild.name, `${COLOR.green}Auto-reacted ${emoji} to target message ${messageId} in #${channel.name}`);
					}
				}
			} catch (e) {
				BotLogs(guild.name, `${COLOR.yellow}Warning: Failed to auto-react to target message ${messageId}: ${e.message}`);
			}
		}
	}
});

client.on('warn', (info) => BotLogs('SYSTEM', `${COLOR.yellow}[Discord Warn] ${info}`));
client.on('error', (error) => BotLogs('SYSTEM', `${COLOR.red}[Discord Error] ${error.stack || error.toString()}`));
client.on('shardError', (error, shardId) => BotLogs('SYSTEM', `${COLOR.red}[Discord Shard ${shardId} Error] ${error.stack || error.toString()}`));

// Ordinary 429s never reached the logs before, so the only evidence of a rate
// limit problem was the eventual block. Now every one of them names the route
// that caused it, which is where you start looking when the numbers climb.
//
// This fires on the pre-emptive wait — our own bucket accounting saying "you
// have spent this route's budget, hold on". It is not the same event as a 429
// coming back from Discord, which @discordjs/rest handles without emitting
// anything; that one is caught by shouldStopForRateLimit above. Both are worth
// seeing, because these are the early warning and the block is what happens
// after they are ignored.
client.rest.on('rateLimited', (info) => {
	BotLogs('SYSTEM', `${COLOR.yellow}[Discord Rate Limit] ${info.method} ${info.route} — waiting ${info.timeToReset}ms${info.global ? ' (GLOBAL)' : ''}`);
});

// A rejected login used to be an unhandled rejection: the process died without
// saying why, index.js restarted it three seconds later, and it died again. If
// the reason was a Cloudflare block, that loop hammered Discord every three
// seconds and kept the block alive. Now the reason is logged and the exit code
// tells the supervisor whether a quick restart is safe.
client.login(process.env.BOT_TOKEN).catch((error) => {
	if (isGlobalBlock(error)) {
		BotLogs('SYSTEM', `${COLOR.red}Discord is blocking this server's IP address. NOT retrying — see DISCORD-RATE-LIMITS.md.`);
		process.exit(BLOCK_EXIT_CODE);
	}
	BotLogs('SYSTEM', `${COLOR.red}Discord login failed: ${COLOR.white}${error.message}`);
	process.exit(1);
});
