'use strict';

const { createAnnounceGuard, MAX_ENTRIES_PER_GUILD } = require('./voice-announce');

const BATCH_WINDOW_MS = 1500;

function joinNames(names, lang) {
	if (names.length < 2) return names[0] || '';
	const and = String(lang).toLowerCase().startsWith('en') ? 'and' : 'และ';
	return `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`;
}

function formatAnnouncement(template, entries, lang, serverName) {
	return template.replace(/{(displayname|nickname|username|tag|server)}/gi, (_, field) => {
		const key = field.toLowerCase();
		return key === 'server' ? serverName : joinNames(entries.map(entry => entry.names[key]), lang);
	});
}

/**
 * Fixed windows per guild/channel/direction. Pending records contain only IDs,
 * text and settings; lookup resolves runtime objects again at admission/flush.
 * ponytail: process-local batches, not a cross-process voice coordinator.
 */
function createVoiceAnnouncementBatcher({ lookup, enqueue, onError = () => {},
	now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
	const guard = createAnnounceGuard();
	const pending = new Map();
	const identities = new WeakMap();
	let identity = 0;
	// Tickets held by in-flight handlers are invalidated without retaining guilds.
	let generation = 0;
	const generations = new WeakMap();

	function capture(guildId, channelId) {
		const current = lookup(guildId);
		if (!current?.guild || !current.connection || current.channelId !== channelId) return null;
		if (!identities.has(current.connection)) identities.set(current.connection, ++identity);
		return { guildId, channelId, identity: identities.get(current.connection), generation: generations.get(current.guild) };
	}

	function resolve(ticket) {
		const fresh = capture(ticket.guildId, ticket.channelId);
		if (!fresh || fresh.identity !== ticket.identity || fresh.generation !== ticket.generation) return null;
		return lookup(ticket.guildId);
	}

	function flush(key, expected) {
		const batch = pending.get(key);
		if (!batch || batch !== expected) return;
		pending.delete(key);
		clearTimer(batch.timer);
		try {
			const current = resolve(batch.destination);
			if (!current?.ready) return;
			const entries = [...batch.entries.values()].filter(entry => {
				const channelId = current.memberChannelId(entry.userId);
				// Unknown cached state is not proof that a member left.
				return channelId !== undefined && (batch.event === 'join'
					? channelId === batch.destination.channelId : channelId !== batch.destination.channelId);
			});
			const result = guard.claimBatch({ guildId: batch.destination.guildId,
				userIds: entries.map(entry => entry.userId), event: batch.event, now: now(), ...batch.limits });
			if (result.enteredQuiet) {
				enqueue(current, batch.quietTemplate, batch.speech, []);
				return;
			}
			if (!result.speak) return;
			const allowed = new Set(result.userIds);
			const selected = entries.filter(entry => allowed.has(entry.userId));
			enqueue(current, formatAnnouncement(batch.template, selected, batch.speech.lang, current.serverName), batch.speech, selected);
		}
		catch (error) { onError(error); }
	}

	function cancel(guildId) {
		for (const [key, batch] of pending) {
			if (batch.destination.guildId !== guildId) continue;
			clearTimer(batch.timer);
			pending.delete(key);
		}
		const guild = lookup(guildId)?.guild;
		if (guild) generations.set(guild, ++generation);
	}

	return {
		capture,
		cancel,
		add({ destination, event, userId, names, template, speech, limits, quietTemplate }) {
			if (!destination || !['join', 'leave'].includes(event) || !userId || !template || !resolve(destination)) return false;
			const key = JSON.stringify([destination.guildId, destination.channelId, event]);
			let batch = pending.get(key);
			if (batch && (batch.destination.identity !== destination.identity || batch.destination.generation !== destination.generation)) {
				clearTimer(batch.timer);
				pending.delete(key);
				batch = null;
			}
			if (!batch) {
				batch = { destination: { ...destination }, event, template, speech: { ...speech },
					limits: { ...limits }, quietTemplate, entries: new Map(), timer: null };
				pending.set(key, batch);
				batch.timer = setTimer(() => flush(key, batch), BATCH_WINDOW_MS);
				batch.timer?.unref?.();
			}
			if (!batch.entries.has(userId) && batch.entries.size >= MAX_ENTRIES_PER_GUILD) {
				// Explicit safety cap per batch, independent of configurable flood limits.
				if (!batch.capped) onError(new Error(`Voice announcement batch exceeded ${MAX_ENTRIES_PER_GUILD} members`));
				batch.capped = true;
				return false;
			}
			batch.entries.set(userId, { userId, names: { ...names } });
			return true;
		},
		forget(guildId) {
			cancel(guildId);
			guard.forget(guildId);
		},
		size() { return pending.size; },
	};
}

module.exports = { createVoiceAnnouncementBatcher, BATCH_WINDOW_MS, formatAnnouncement };
