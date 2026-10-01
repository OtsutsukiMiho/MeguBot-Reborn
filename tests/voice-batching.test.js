'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createVoiceAnnouncementBatcher, BATCH_WINDOW_MS } = require('../core/voice-announcement-batches');
const { createAnnounceGuard, MAX_ENTRIES_PER_GUILD } = require('../core/voice-announce');
let checks = 0;
const ok = name => { checks++; console.log(`  ok  ${name}`); };

function clock() {
	let time = 1000000;
	const timers = new Set();
	return { now: () => time, timers,
		setTimer(fn, delay) { const timer = { fn, at: time + delay }; timers.add(timer); return timer; },
		clearTimer(timer) { timers.delete(timer); },
		advance(ms) { time += ms; for (const timer of [...timers]) if (timer.at <= time) { timers.delete(timer); timer.fn(); } },
	};
}

function fixture() {
	const time = clock(), spoken = [], errors = [], members = new Map();
	const current = { guild: {}, channelId: 'vc', connection: {}, ready: true, serverName: 'Server',
		memberChannelId: id => members.get(id) };
	const batcher = createVoiceAnnouncementBatcher({ ...time, lookup: () => current,
		enqueue: (_current, text, speech, entries) => spoken.push({ text, speech, entries }),
		onError: error => errors.push(error) });
	function add(id, event = 'join', extra = {}) {
		members.set(id, event === 'join' ? 'vc' : null);
		return batcher.add({ destination: batcher.capture('g', 'vc'), event, userId: id,
			names: { username: id, nickname: `nick-${id}`, displayname: `display-${id}`, tag: `tag-${id}` },
			template: `{username} ${event === 'join' ? 'เข้าดิสมา' : 'ออกจากดิสแล้ว'}`,
			speech: { lang: 'th', type: 'TTS', voice: 'voice', volume: 0.5 }, quietTemplate: 'quiet', ...extra });
	}
	return { time, spoken, errors, members, current, batcher, add };
}

{
	const f = fixture();
	f.add('A'); f.time.advance(700); f.add('B'); f.add('C');
	assert.equal(f.time.timers.size, 1);
	f.time.advance(799); assert.equal(f.spoken.length, 0);
	f.time.advance(1);
	assert.equal(f.spoken[0].text, 'A, B และ C เข้าดิสมา');
	assert.equal(f.batcher.size(), 0); assert.equal(f.time.timers.size, 0);
	ok('rapid joins share one fixed 1.5-second window and retain all names');
	f.add('D'); f.time.advance(BATCH_WINDOW_MS);
	assert.equal(f.spoken.length, 2); assert.equal(f.spoken[1].text, 'D เข้าดิสมา');
	ok('outside-window arrivals get a separate unchanged single-member line');
}
{
	const f = fixture();
	f.add('A', 'leave'); f.add('B', 'leave'); f.add('B', 'leave'); f.add('C');
	f.time.advance(BATCH_WINDOW_MS);
	assert.deepEqual(f.spoken.map(line => line.text), ['A และ B ออกจากดิสแล้ว', 'C เข้าดิสมา']);
	ok('leaves deduplicate and never merge with simultaneous joins');
}
{
	const f = fixture();
	f.add('A'); f.add('A', 'leave'); f.add('B', 'leave'); f.add('B');
	f.time.advance(BATCH_WINDOW_MS);
	assert.deepEqual(f.spoken.map(line => line.text), ['B เข้าดิสมา', 'A ออกจากดิสแล้ว']);
	f.add('B'); f.time.advance(BATCH_WINDOW_MS);
	assert.equal(f.spoken.length, 2);
	ok('rapid state changes describe current membership and preserve reconnect cooldowns');
}
{
	const f = fixture();
	for (let i = 0; i < 20; i++) f.add(`person-${i}`);
	f.time.advance(BATCH_WINDOW_MS);
	assert.equal(f.spoken.length, 1); assert.equal(f.spoken[0].entries.length, 20);
	for (let i = 0; i < 20; i++) assert.ok(f.spoken[0].text.includes(`person-${i}`));
	ok('twenty arrivals count as one workload claim, without pre-batch name loss');
}
{
	const f = fixture(), limits = { floodCount: 2, quietMs: 5000, floodWindowMs: 30000 };
	for (const id of ['A', 'B', 'C', 'D']) { f.add(id, 'join', { limits }); f.time.advance(BATCH_WINDOW_MS); }
	assert.deepEqual(f.spoken.map(line => line.text), ['A เข้าดิสมา', 'B เข้าดิสมา', 'quiet']);
	f.time.advance(5000); f.add('C', 'join', { limits }); f.time.advance(BATCH_WINDOW_MS);
	assert.equal(f.spoken.at(-1).text, 'C เข้าดิสมา');
	ok('flood/quiet protections still apply to clips, emit one notice, and do not claim suppressed names');
}
for (const state of ['disconnected', 'moved', 'replaced', 'unready', 'unknown member']) {
	const f = fixture(); f.add('A');
	if (state === 'disconnected') f.current.connection = null;
	if (state === 'moved') f.current.channelId = 'other';
	if (state === 'replaced') f.current.connection = {};
	if (state === 'unready') f.current.ready = false;
	if (state === 'unknown member') f.members.delete('A');
	f.time.advance(BATCH_WINDOW_MS);
	assert.equal(f.spoken.length, 0); assert.equal(f.batcher.size(), 0); assert.equal(f.time.timers.size, 0);
	ok(`${state} state cancels stale playback and releases the batch`);
}
{
	const f = fixture(); f.add('A');
	const ticket = f.batcher.capture('g', 'vc');
	const cancelledTimer = [...f.time.timers][0];
	f.batcher.forget('g');
	assert.equal(f.batcher.add({ destination: ticket, event: 'join', userId: 'late', template: 'late' }), false);
	f.add('B'); cancelledTimer.fn(); assert.equal(f.spoken.length, 0);
	f.time.advance(BATCH_WINDOW_MS); assert.equal(f.spoken[0].text, 'B เข้าดิสมา');
	ok('move-away/back invalidates in-flight tickets; a cancelled timer cannot flush its replacement');
}
{
	const f = fixture();
	f.add('A', 'join', { template: '{displayname}|{nickname}|{username}|{tag}|{server}', speech: { lang: 'en-US' } });
	f.add('B'); f.time.advance(BATCH_WINDOW_MS);
	assert.equal(f.spoken[0].text, 'display-A and display-B|nick-A and nick-B|A and B|tag-A and tag-B|Server');
	ok('custom templates preserve each nickname/display-name/tag placeholder and EN/TH conjunctions');
}
{
	const f = fixture();
	for (let i = 0; i < MAX_ENTRIES_PER_GUILD; i++) assert.equal(f.add(`u-${i}`), true);
	assert.equal(f.add('over-cap'), false); assert.equal(f.add('over-cap-again'), false);
	assert.equal(f.errors.length, 1);
	f.batcher.forget('g'); assert.equal(f.time.timers.size, 0); assert.equal(f.batcher.size(), 0);
	ok('hard cap is explicit, reported once, and guild teardown cancels all timers');
}
{
	const time = clock(), guild = {}, errors = [];
	const batcher = createVoiceAnnouncementBatcher({ ...time,
		lookup: () => ({ guild, connection: guild, ready: true, channelId: 'vc', memberChannelId: () => 'vc' }),
		enqueue: () => { throw new Error('queue unavailable'); }, onError: error => errors.push(error) });
	batcher.add({ destination: batcher.capture('g', 'vc'), userId: 'a', event: 'join',
		names: { username: 'a' }, template: '{username}', speech: {}, limits: {} });
	time.advance(BATCH_WINDOW_MS);
	assert.equal(errors[0].message, 'queue unavailable'); assert.equal(batcher.size(), 0);
	ok('queue exceptions leave no pending batch or timer');
}
{
	const guard = createAnnounceGuard();
	assert.equal(guard.claimBatch({ guildId: 'g', event: 'join', userIds: ['a', 'a', 'b'] }).userIds.length, 2);
	assert.equal(guard.claimBatch({ guildId: 'g', event: 'join', userIds: ['a', 'c'] }).userIds.join(','), 'c');
	ok('batch guard keeps per-member cooldown semantics across grouped announcements');
}
{
	const f = fixture(); f.add('A'); f.time.advance(BATCH_WINDOW_MS);
	f.batcher.cancel('g'); f.add('A'); f.time.advance(BATCH_WINDOW_MS);
	assert.equal(f.spoken.length, 1);
	f.batcher.forget('g'); f.add('A'); f.time.advance(BATCH_WINDOW_MS);
	assert.equal(f.spoken.length, 2);
	ok('bot movement cancels batches without resetting cooldowns; an emptied guild re-arms them');
	const flood = fixture();
	flood.add('A', 'join', { limits: { floodCount: 1 } }); flood.time.advance(BATCH_WINDOW_MS);
	flood.batcher.cancel('g'); flood.add('B', 'join', { limits: { floodCount: 1 } }); flood.time.advance(BATCH_WINDOW_MS);
	assert.deepEqual(flood.spoken.map(line => line.text), ['A เข้าดิสมา', 'quiet']);
	ok('bot movement cannot bypass the flood workload budget');
}
{
	const time = clock(), guilds = new Map([['g1', {}], ['g2', {}]]), spoken = [];
	const batcher = createVoiceAnnouncementBatcher({ ...time,
		lookup: id => ({ guild: guilds.get(id), connection: guilds.get(id), channelId: 'vc', ready: true,
			memberChannelId: () => 'vc', serverName: id }), enqueue: (current, text) => spoken.push([current.serverName, text]) });
	for (const guildId of guilds.keys()) batcher.add({ destination: batcher.capture(guildId, 'vc'),
		userId: 'same-user', event: 'join', names: { username: 'Name' }, template: '{username}', speech: {}, limits: {} });
	batcher.forget('g1'); time.advance(BATCH_WINDOW_MS);
	assert.deepEqual(spoken, [['g2', 'Name']]);
	assert.equal(batcher.size(), 0);
	ok('guilds stay isolated even when user IDs and channel IDs match');
}

// Execute the actual bot handler and current queue entry bridge with substituted
// Discord/database boundaries. No login, network, or production DB is involved.
async function integration() {
	const time = clock(), queued = [], audits = [], handlers = new Map();
	const { Collection } = require('discord.js');
	const bot = { id: 'bot', voice: { channelId: 'vc' }, user: { username: 'Megu' } };
	const channel = { id: 'vc', name: 'Room', type: 2, members: new Collection([['bot', bot]]) };
	bot.voice.channel = channel;
	const members = new Collection([['bot', bot]]);
	const guild = { id: 'g', name: 'Server', afkChannelId: 'afk', members: { me: bot, cache: members },
		channels: { cache: new Collection([['vc', channel]]) } };
	let connection = { joinConfig: { channelId: 'vc' }, state: { status: 'ready' }, destroy() { this.state.status = 'destroyed'; } };
	const vars = { tts_afk_bringback_enabled: false };
	const optedOut = new Set();
	let nickRead = async (_g, id) => `nick-${id}`;
	const database = { getGuildVar: async (_g, name) => vars[name], getAnnounceOptOut: async (_g, id) => optedOut.has(id),
		getUserNick: (...args) => nickRead(...args), logAuditEvent: async (...args) => audits.push(args) };
	const source = fs.readFileSync(require.resolve('../backend/bot/bot'), 'utf8');
	const start = source.indexOf('const voiceStateProcessing = new Set();');
	const end = source.indexOf('\nfunction formatAbbreviation', start);
	assert.ok(start > 0 && end > start);
	vm.runInNewContext(source.slice(start, end), {
		client: { user: bot.user, guilds: { cache: new Map([['g', guild]]) }, on: (event, fn) => handlers.set(event, fn) },
		// The bot's member ID and client ID are identical.
		Events: { VoiceStateUpdate: 'voice', GuildDelete: 'delete' }, database,
		getVoiceConnection: () => connection, getOrCreateConnection: () => { throw new Error('Batch must not create a connection'); },
		BotLogs: () => {}, COLOR: {}, stamp: text => text, autoJoinActiveVC: async () => {},
		discordCall: async (_label, fn) => fn(), setTimeout: time.setTimer,
		require: name => {
			if (name.includes('voice-announcement-batches')) return { createVoiceAnnouncementBatcher: options => createVoiceAnnouncementBatcher({ ...options, ...time }) };
			if (name.includes('core/voice-announce')) return require('../core/voice-announce');
			if (name === './audio_queue.js') return { generateUUID: () => 'id', audioQueueManager: { getQueue: () => [], clearQueue: () => {} },
				clearQueue: () => {}, addToQueue: (_g, entry) => { queued.push(entry); return { success: true }; } };
			throw new Error(`Unexpected dependency ${name}`);
		},
	});
	// Correct user identity for self filtering after setup.
	bot.user.id = 'bot';
	function member(id) {
		const m = { id, nickname: `display-${id}`, user: { username: `tag-${id}` }, voice: { channelId: 'vc' } };
		members.set(id, m); channel.members.set(id, m); return m;
	}
	function event(m, oldId, newId) {
		m.voice.channelId = newId;
		if (newId === 'vc') channel.members.set(m.id, m); else channel.members.delete(m.id);
		return handlers.get('voice')({ id: m.id, guild, member: m, channelId: oldId, channel: oldId === 'vc' ? channel : null },
			{ id: m.id, guild, member: m, channelId: newId, channel: newId === 'vc' ? channel : null });
	}
	const people = Array.from({ length: 12 }, (_, i) => member(`p${i}`));
	await Promise.all(people.map(m => event(m, null, 'vc')));
	assert.equal(queued.length, 0); time.advance(BATCH_WINDOW_MS);
	assert.equal(queued.length, 1);
	for (const m of people) assert.ok(queued[0].name.includes(`nick-${m.id}`));
	assert.equal(queued[0].connection, connection); assert.equal(queued[0].voice_channel, channel);
	assert.equal(queued[0].type, 'TTS'); assert.equal(queued[0].volume, 0.5); assert.equal(audits.length, 12);
	ok('actual concurrent voice handler batches all twelve arrivals through the current audio bridge');
	optedOut.add('private'); await event(member('private'), null, 'vc'); time.advance(BATCH_WINDOW_MS);
	assert.equal(queued.length, 1);
	ok('actual handler still respects announcement opt-out');
	await Promise.all(people.slice(0, 3).map(m => event(m, 'vc', null))); time.advance(BATCH_WINDOW_MS);
	assert.equal(queued.length, 2); assert.ok(queued[1].name.includes('ออกจากดิสแล้ว'));
	ok('actual handler groups departures while the bot remains in an occupied room');
	await event(member('afk-return'), 'afk', 'vc'); time.advance(BATCH_WINDOW_MS);
	assert.equal(queued.length, 2);
	ok('AFK-return join suppression stays unchanged');
	let bringbacks = 0;
	vars.tts_afk_bringback_enabled = true;
	const afkMember = member('afk'); afkMember.voice.setChannel = async () => { bringbacks++; };
	await event(afkMember, 'vc', 'afk'); time.advance(BATCH_WINDOW_MS);
	assert.equal(bringbacks, 1); assert.equal(queued.length, 2);
	ok('AFK bring-back keeps its existing move behavior and does not announce a leave');
	vars.tts_afk_bringback_enabled = false;
	await event(member('stale'), null, 'vc'); connection = { ...connection };
	time.advance(BATCH_WINDOW_MS); assert.equal(queued.length, 2);
	ok('actual handler drops a batch when Discord replaces the connection');
	for (const status of ['destroyed', 'disconnected', 'connecting']) {
		await event(member(`state-${status}`), null, 'vc'); connection.state = { status };
		time.advance(BATCH_WINDOW_MS); assert.equal(queued.length, 2);
		connection = { ...connection, state: { status: 'ready' } };
	}
	await event(member('wrong-target'), null, 'vc'); connection.joinConfig = { channelId: 'other' };
	time.advance(BATCH_WINDOW_MS); assert.equal(queued.length, 2);
	connection = { ...connection, joinConfig: { channelId: 'vc' } };
	ok('actual lookup rejects dead/unready connections and mismatched connection destinations');
	await event(member('move-stale'), null, 'vc');
	await event(bot, 'vc', 'other'); bot.voice.channelId = 'vc';
	time.advance(BATCH_WINDOW_MS); assert.equal(queued.length, 2);
	ok('bot move cancels pending batches even if it returns to the same connection');
	let release;
	nickRead = () => new Promise(resolve => { release = resolve; });
	const inFlight = event(member('slow-nick'), null, 'vc');
	while (!release) await new Promise(resolve => setImmediate(resolve));
	await event(bot, 'vc', null); bot.voice.channelId = 'vc'; release('late');
	await inFlight; time.advance(BATCH_WINDOW_MS); assert.equal(queued.length, 2);
	ok('disconnect while an async nickname lookup is pending cannot resurrect a stale batch');
	nickRead = async (_g, id) => `nick-${id}`;
	await event(member('guild-left'), null, 'vc'); handlers.get('delete')(guild);
	time.advance(BATCH_WINDOW_MS); assert.equal(queued.length, 2);
	ok('guild deletion cancels membership timers without delivering their contents');
	await event(bot, 'vc', 'vc'); await event(member('elsewhere'), 'other', 'another');
	time.advance(BATCH_WINDOW_MS); assert.equal(queued.length, 2);
	ok('self updates and moves between unrelated channels do not generate membership clips');
	await Promise.all([event(member('from-other'), 'other', 'vc'), event(member('to-other'), 'vc', 'other')]);
	time.advance(BATCH_WINDOW_MS);
	assert.equal(queued.length, 4);
	assert.ok(queued.slice(2).some(entry => entry.name === 'nick-from-other เข้าดิสมา'));
	assert.ok(queued.slice(2).some(entry => entry.name === 'nick-to-other ออกจากดิสแล้ว'));
	ok('moves into/out of the bot room retain separate join/leave meanings');
	vars.tts_engine = 'GOOGLE_TTS'; vars.tts_voice = 'custom-voice'; vars.tts_lang = 'en-US'; vars.tts_volume = '0.8';
	vars.tts_vc_welcome_template = '{displayname} / {nickname} / {tag} in {server}';
	nickRead = async () => 'ใครไม่รู้';
	await event(member('fallback-name'), null, 'vc'); time.advance(BATCH_WINDOW_MS);
	assert.equal(queued.length, 5); assert.equal(queued[4].type, 'GOOGLE_TTS');
	assert.equal(queued[4].lang, 'en-US'); assert.equal(queued[4].voice, 'custom-voice'); assert.equal(queued[4].volume, 0.8);
	assert.equal(queued[4].name, 'display-fallback-name / display-fallback-name / tag-fallback-name in Server');
	ok('single-member custom templates, nickname fallback, engine, language, voice and volume stay intact');
	const last = member('last'); await event(last, null, 'vc');
	channel.members.clear(); channel.members.set('bot', bot);
	for (const m of members.values()) if (m.id !== 'bot') m.voice.channelId = null;
	await event(last, 'vc', null); time.advance(BATCH_WINDOW_MS);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(queued.length, 5); assert.equal(connection.state.status, 'destroyed');
	ok('an emptied guild cancels pending announcements and preserves disconnect/auto-join cleanup');
	assert.equal(time.timers.size, 0);
}

integration().then(() => console.log(`\n${checks} voice batching checks passed`)).catch(error => { console.error(error); process.exitCode = 1; });
