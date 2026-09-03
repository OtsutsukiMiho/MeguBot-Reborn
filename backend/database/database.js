const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { BotLogs, COLOR } = require('../bot/bot_functions.js');

const DATA_DIR = path.join(__dirname, 'data');
const VARS_DIR = path.join(DATA_DIR, 'variables');
const NICK_DIR = path.join(DATA_DIR, 'nick');
const AUDIT_DIR = path.join(DATA_DIR, 'audit');
const REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json');

let pool = null;

function isValidSnowflake(id) {
	return typeof id === 'string' && /^\d{17,20}$/.test(id);
}

/**
 * index.js forks two processes and both of them open this pool, and each also
 * opens core's. Four pools at pg's default of 10 is forty connections against
 * one database — enough to exhaust a small Postgres on its own, and certain to
 * if the web process ever crash-loops and keeps reconnecting.
 *
 * Five is generous for this workload: every query here is a short read or
 * write and none of them run concurrently in any number. The idle timeout is
 * what actually protects the database — connections go back after ten seconds
 * rather than being held for the life of the process — and the connect timeout
 * means a database that is refusing connections produces an error instead of a
 * queue of requests waiting forever.
 */
const POOL_LIMITS = {
	max: Number(process.env.PG_POOL_MAX) || 5,
	idleTimeoutMillis: 10_000,
	connectionTimeoutMillis: 8_000,
};

if (process.env.DATABASE_URL) {
	pool = new Pool({
		connectionString: process.env.DATABASE_URL,
		ssl: {
			rejectUnauthorized: false,
		},
		...POOL_LIMITS,
	});
	pool.on('error', (err) => {
		BotLogs('Database', `${COLOR.red}PostgreSQL pool error: ${err.message}`);
	});
}

async function initDatabase() {
	if (pool) {
		try {
			const client = await pool.connect();
			BotLogs('Database', `${COLOR.green}Connected to PostgreSQL database!`);

			await client.query(`
				CREATE TABLE IF NOT EXISTS guild_variables (
					guild_id VARCHAR(30) PRIMARY KEY,
					variables JSONB DEFAULT '{}'::jsonb
				);
			`);
			await client.query(`
				CREATE TABLE IF NOT EXISTS user_nicks (
					guild_id VARCHAR(30),
					user_id VARCHAR(30),
					nickname VARCHAR(100) NOT NULL,
					PRIMARY KEY (guild_id, user_id)
				);
			`);
			// Announcing an arrival is done for the room, not for the person
			// arriving, so the person arriving is the one who never consented to
			// it. Someone who does not want their name read out loud every time
			// they join needs a way to say so that does not involve asking an
			// admin to turn the feature off for everybody.
			await client.query(`
				CREATE TABLE IF NOT EXISTS user_voice_prefs (
					guild_id VARCHAR(30),
					user_id VARCHAR(30),
					announce_opt_out BOOLEAN NOT NULL DEFAULT FALSE,
					PRIMARY KEY (guild_id, user_id)
				);
			`);
			await client.query(`
				CREATE TABLE IF NOT EXISTS reminders (
					id SERIAL PRIMARY KEY,
					user_id VARCHAR(30) NOT NULL,
					guild_id VARCHAR(30) NOT NULL,
					channel_id VARCHAR(30) NOT NULL,
					reminder_time BIGINT NOT NULL,
					message TEXT NOT NULL,
					recurring VARCHAR(50),
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				);
			`);
			await client.query(`
				CREATE TABLE IF NOT EXISTS audit_logs (
					id SERIAL PRIMARY KEY,
					guild_id VARCHAR(30) NOT NULL,
					guild_name VARCHAR(100),
					event_type VARCHAR(50) NOT NULL,
					user_id VARCHAR(30),
					username VARCHAR(100),
					details TEXT,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				);
			`);
			await client.query(`
				CREATE TABLE IF NOT EXISTS developer_users (
					user_id VARCHAR(30) PRIMARY KEY,
					username VARCHAR(100),
					added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				);
			`);
			await client.query(`
				CREATE TABLE IF NOT EXISTS audio_logs (
					id SERIAL PRIMARY KEY,
					item_id VARCHAR(50),
					guild_id VARCHAR(30) NOT NULL,
					guild_name VARCHAR(100),
					user_name VARCHAR(100),
					text TEXT NOT NULL,
					engine VARCHAR(50),
					voice VARCHAR(100),
					lang VARCHAR(10),
					status VARCHAR(30) NOT NULL,
					error_message TEXT,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				);
				CREATE INDEX IF NOT EXISTS idx_audio_logs_guild ON audio_logs(guild_id);
				CREATE INDEX IF NOT EXISTS idx_audio_logs_status ON audio_logs(status);
				CREATE INDEX IF NOT EXISTS idx_audio_logs_item ON audio_logs(item_id);
			`);
			client.release();
			BotLogs('Database', `${COLOR.green}PostgreSQL tables verified/created successfully.`);
			cleanOldAuditLogs(7).catch(() => undefined);
			cleanOldAudioLogs(7).catch(() => undefined);
		}
		catch (error) {
			BotLogs('Database', `${COLOR.red}Failed to connect to PostgreSQL: ${error.message}. Falling back to local JSON database.`);
			pool = null;
		}
	}

	if (!pool) {
		if (!fs.existsSync(VARS_DIR)) {
			fs.mkdirSync(VARS_DIR, { recursive: true });
		}
		if (!fs.existsSync(NICK_DIR)) {
			fs.mkdirSync(NICK_DIR, { recursive: true });
		}
		BotLogs('Database', `${COLOR.blue}Using local JSON file-based database.`);
	}
}

function sanitizeDbValue(val) {
	if (typeof val === 'string') {
		const s = val.trim();
		if (s === 'true') return true;
		if (s === 'false') return false;
		if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']')) || (s.startsWith('"') && s.endsWith('"'))) {
			try {
				const unquoted = JSON.parse(s);
				if (typeof unquoted === 'string') return sanitizeDbValue(unquoted);
				return unquoted;
			} catch {}
		}
	}
	if (typeof val === 'object' && val !== null) {
		if (Array.isArray(val)) {
			return val.map(sanitizeDbValue);
		}
		const cleaned = {};
		for (const [k, v] of Object.entries(val)) {
			cleaned[k] = sanitizeDbValue(v);
		}
		return cleaned;
	}
	return val;
}

async function getGuildVar(guildId, key) {
	if (pool) {
		try {
			const res = await pool.query(
				'SELECT variables->$2 AS val FROM guild_variables WHERE guild_id = $1',
				[guildId, key],
			);
			if (res.rows.length > 0 && res.rows[0].val !== null) {
				return sanitizeDbValue(res.rows[0].val);
			}
			return null;
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in getGuildVar: ${error.message}`);
			return null;
		}
	}
	else {
		if (!isValidSnowflake(guildId)) return null;
		const dbPath = path.join(VARS_DIR, `${guildId}.json`);
		if (fs.existsSync(dbPath)) {
			try {
				const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
				return data[key] !== undefined ? sanitizeDbValue(data[key]) : null;
			}
			catch {
				return null;
			}
		}
		return null;
	}
}

async function getAllGuildVars(guildId) {
	if (pool) {
		try {
			const res = await pool.query(
				'SELECT variables FROM guild_variables WHERE guild_id = $1',
				[guildId],
			);
			if (res.rows.length > 0 && res.rows[0].variables) {
				return sanitizeDbValue(res.rows[0].variables);
			}
			return {};
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in getAllGuildVars: ${error.message}`);
			return {};
		}
	}
	else {
		if (!isValidSnowflake(guildId)) return {};
		const dbPath = path.join(VARS_DIR, `${guildId}.json`);
		if (fs.existsSync(dbPath)) {
			try {
				const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8')) || {};
				return sanitizeDbValue(raw);
			}
			catch {
				return {};
			}
		}
		return {};
	}
}

async function setGuildVar(guildId, key, value) {
	const cleanValue = sanitizeDbValue(value);

	if (pool) {
		try {
			const jsonVal = cleanValue !== null && cleanValue !== undefined ? JSON.stringify(cleanValue) : 'null';
			await pool.query(
				`INSERT INTO guild_variables (guild_id, variables)
				 VALUES ($1, jsonb_build_object($2::text, $3::jsonb))
				 ON CONFLICT (guild_id) DO UPDATE
				 SET variables = jsonb_set(COALESCE(guild_variables.variables, '{}'::jsonb), ARRAY[$2::text], $3::jsonb)`,
				[guildId, key, jsonVal],
			);
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in setGuildVar: ${error.message}`);
		}
	}
	else {
		if (!isValidSnowflake(guildId)) return;
		const dbPath = path.join(VARS_DIR, `${guildId}.json`);
		let guildData = {};
		if (fs.existsSync(dbPath)) {
			try {
				guildData = sanitizeDbValue(JSON.parse(fs.readFileSync(dbPath, 'utf8'))) || {};
			}
			catch {
				guildData = {};
			}
		}
		guildData[key] = cleanValue;
		fs.writeFileSync(dbPath, JSON.stringify(guildData, null, 4));
	}
}

async function deleteGuildVar(guildId, key) {
	if (pool) {
		try {
			await pool.query(
				'UPDATE guild_variables SET variables = variables - $2 WHERE guild_id = $1',
				[guildId, key],
			);
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in deleteGuildVar: ${error.message}`);
		}
	}
	else {
		if (!isValidSnowflake(guildId)) return;
		const dbPath = path.join(VARS_DIR, `${guildId}.json`);
		if (fs.existsSync(dbPath)) {
			let guildData = {};
			try {
				guildData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
			}
			catch {
				// Ignore
			}
			if (guildData[key] !== undefined) {
				delete guildData[key];
				fs.writeFileSync(dbPath, JSON.stringify(guildData, null, 4));
			}
		}
	}
}

/**
 * Has this person asked not to have their name read out when they join?
 *
 * Answers false when the database is unreachable, on purpose. The failure this
 * protects against is announcing somebody who asked not to be announced, and a
 * lost connection is not consent — but a bot that refuses to greet anybody
 * because a query timed out is a broken feature, not a private one. The cache
 * below keeps that window small.
 */
async function getAnnounceOptOut(guildId, userId) {
	if (!pool) return false;
	try {
		const res = await pool.query(
			'SELECT announce_opt_out FROM user_voice_prefs WHERE guild_id = $1 AND user_id = $2',
			[guildId, userId],
		);
		return res.rows.length > 0 ? Boolean(res.rows[0].announce_opt_out) : false;
	}
	catch (error) {
		BotLogs('SYSTEM', `${COLOR.red}Database error in getAnnounceOptOut: ${error.message}`);
		return false;
	}
}

async function setAnnounceOptOut(guildId, userId, optOut) {
	if (!pool) return false;
	try {
		await pool.query(
			`INSERT INTO user_voice_prefs (guild_id, user_id, announce_opt_out)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (guild_id, user_id) DO UPDATE SET announce_opt_out = $3`,
			[guildId, userId, Boolean(optOut)],
		);
		return true;
	}
	catch (error) {
		BotLogs('SYSTEM', `${COLOR.red}Database error in setAnnounceOptOut: ${error.message}`);
		return false;
	}
}

async function getUserNick(guildId, userId) {
	if (pool) {
		try {
			const res = await pool.query(
				'SELECT nickname FROM user_nicks WHERE guild_id = $1 AND user_id = $2',
				[guildId, userId],
			);
			if (res.rows.length > 0) {
				return res.rows[0].nickname;
			}
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in getUserNick: ${error.message}`);
		}
		return 'ใครไม่รู้';
	}
	else {
		if (!isValidSnowflake(guildId)) return 'ใครไม่รู้';
		const dbPath = path.join(NICK_DIR, `${guildId}.json`);
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
			catch {
				// Ignore
			}
		}
		return 'ใครไม่รู้';
	}
}

async function setUserNick(guildId, userId, name) {
	if (pool) {
		try {
			await pool.query(
				`INSERT INTO user_nicks (guild_id, user_id, nickname)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (guild_id, user_id) DO UPDATE
				 SET nickname = EXCLUDED.nickname`,
				[guildId, userId, name],
			);
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in setUserNick: ${error.message}`);
		}
	}
	else {
		if (!isValidSnowflake(guildId)) return;
		const dbPath = path.join(NICK_DIR, `${guildId}.json`);
		let nick = { users: [] };
		if (fs.existsSync(dbPath)) {
			try {
				nick = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
				if (!nick.users) {
					nick = { users: [] };
				}
			}
			catch {
				// Ignore
			}
		}
		const userIndex = nick.users.findIndex(u => u.id === userId);
		if (userIndex !== -1) {
			nick.users[userIndex].name = name;
		}
		else {
			nick.users.push({ id: userId, name: name });
		}
		fs.writeFileSync(dbPath, JSON.stringify(nick, null, 2));
	}
}

async function getAllGuildNicks(guildId) {
	const nicks = {};
	if (pool) {
		try {
			const res = await pool.query(
				'SELECT user_id, nickname FROM user_nicks WHERE guild_id = $1',
				[guildId],
			);
			for (const row of res.rows) {
				if (row.user_id && row.nickname) {
					nicks[row.user_id] = row.nickname;
				}
			}
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in getAllGuildNicks: ${error.message}`);
		}
	}
	else {
		if (!isValidSnowflake(guildId)) return {};
		const dbPath = path.join(NICK_DIR, `${guildId}.json`);
		if (fs.existsSync(dbPath)) {
			try {
				const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
				if (data.users && Array.isArray(data.users)) {
					for (const u of data.users) {
						if (u.id && u.name) {
							nicks[u.id] = u.name;
						}
					}
				}
				else if (typeof data === 'object') {
					for (const [uid, name] of Object.entries(data)) {
						if (uid && name && typeof name === 'string') {
							nicks[uid] = name;
						}
					}
				}
			}
			catch {
				// Ignore
			}
		}
	}
	return nicks;
}

async function deleteUserNick(guildId, userId) {
	if (pool) {
		try {
			await pool.query(
				'DELETE FROM user_nicks WHERE guild_id = $1 AND user_id = $2',
				[guildId, userId],
			);
			return true;
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in deleteUserNick: ${error.message}`);
			return false;
		}
	}
	else {
		if (!isValidSnowflake(guildId)) return false;
		const dbPath = path.join(NICK_DIR, `${guildId}.json`);
		if (fs.existsSync(dbPath)) {
			try {
				const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
				if (data.users && Array.isArray(data.users)) {
					data.users = data.users.filter(u => u.id !== userId);
				}
				else if (data[userId]) {
					delete data[userId];
				}
				fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
				return true;
			}
			catch (error) {
				BotLogs('SYSTEM', `${COLOR.red}Error deleting user nick (local): ${error.message}`);
				return false;
			}
		}
		return false;
	}
}

async function getAllHoneypots() {
	const honeypots = new Map();
	if (pool) {
		try {
			const res = await pool.query(
				'SELECT guild_id, variables->>\'honeypot_channel_id\' AS honeypot_id FROM guild_variables WHERE variables->>\'honeypot_channel_id\' IS NOT NULL',
			);
			for (const row of res.rows) {
				if (row.honeypot_id) {
					honeypots.set(row.guild_id, row.honeypot_id);
				}
			}
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in getAllHoneypots: ${error.message}`);
		}
	}
	else {
		try {
			if (fs.existsSync(VARS_DIR)) {
				const files = fs.readdirSync(VARS_DIR).filter(file => file.endsWith('.json'));
				for (const file of files) {
					const guildId = path.basename(file, '.json');
					const rawData = fs.readFileSync(path.join(VARS_DIR, file), 'utf8');
					if (rawData.trim()) {
						const data = JSON.parse(rawData);
						if (data.honeypot_channel_id) {
							honeypots.set(guildId, data.honeypot_channel_id);
						}
					}
				}
			}
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Error initializing honeypot cache (local): ${error.message}`);
		}
	}
	return honeypots;
}

async function getAllTtsChannels() {
	const ttsChannels = new Map();
	if (pool) {
		try {
			const res = await pool.query(
				'SELECT guild_id, variables->>\'tts_channel_id\' AS tts_id FROM guild_variables WHERE variables->>\'tts_channel_id\' IS NOT NULL',
			);
			for (const row of res.rows) {
				if (row.tts_id) {
					ttsChannels.set(row.guild_id, row.tts_id);
				}
			}
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in getAllTtsChannels: ${error.message}`);
		}
	}
	else {
		try {
			if (fs.existsSync(VARS_DIR)) {
				const files = fs.readdirSync(VARS_DIR).filter(file => file.endsWith('.json'));
				for (const file of files) {
					const guildId = path.basename(file, '.json');
					const rawData = fs.readFileSync(path.join(VARS_DIR, file), 'utf8');
					if (rawData.trim()) {
						const data = JSON.parse(rawData);
						if (data.tts_channel_id) {
							ttsChannels.set(guildId, data.tts_channel_id);
						}
					}
				}
			}
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Error initializing tts channel cache (local): ${error.message}`);
		}
	}
	return ttsChannels;
}

async function addReminder(userId, guildId, channelId, timeMs, messageText, recurring = false) {
	if (pool) {
		try {
			await pool.query(
				'INSERT INTO reminders (user_id, guild_id, channel_id, reminder_time, message, recurring) VALUES ($1, $2, $3, $4, $5, $6)',
				[userId, guildId, channelId, timeMs, messageText, recurring],
			);
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in addReminder: ${error.message}`);
		}
	}
	else {
		const filePath = REMINDERS_FILE;
		let reminders = [];
		if (fs.existsSync(filePath)) {
			try {
				reminders = JSON.parse(fs.readFileSync(filePath, 'utf8'));
			}
			catch {
				reminders = [];
			}
		}
		const newReminder = {
			id: Date.now() + Math.random().toString(36).substr(2, 9),
			user_id: userId,
			guild_id: guildId,
			channel_id: channelId,
			reminder_time: timeMs,
			message: messageText,
			triggered: false,
			recurring: recurring,
		};
		reminders.push(newReminder);
		fs.writeFileSync(filePath, JSON.stringify(reminders, null, 2), 'utf8');
	}
}

async function getActiveReminders() {
	if (pool) {
		try {
			const res = await pool.query(
				'SELECT id, user_id, guild_id, channel_id, reminder_time, message, recurring FROM reminders WHERE triggered = FALSE',
			);
			return res.rows.map(row => ({
				id: row.id,
				user_id: row.user_id,
				guild_id: row.guild_id,
				channel_id: row.channel_id,
				reminder_time: Number(row.reminder_time),
				message: row.message,
				recurring: row.recurring,
			}));
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in getActiveReminders: ${error.message}`);
			return [];
		}
	}
	else {
		const filePath = REMINDERS_FILE;
		if (fs.existsSync(filePath)) {
			try {
				const reminders = JSON.parse(fs.readFileSync(filePath, 'utf8'));
				return reminders.filter(r => !r.triggered);
			}
			catch {
				return [];
			}
		}
		return [];
	}
}

async function deleteReminder(id) {
	if (pool) {
		try {
			await pool.query('DELETE FROM reminders WHERE id = $1', [id]);
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in deleteReminder: ${error.message}`);
		}
	}
	else {
		const filePath = REMINDERS_FILE;
		if (fs.existsSync(filePath)) {
			try {
				let reminders = JSON.parse(fs.readFileSync(filePath, 'utf8'));
				reminders = reminders.filter(r => r.id !== id);
				fs.writeFileSync(filePath, JSON.stringify(reminders, null, 2), 'utf8');
			}
			catch (error) {
				BotLogs('SYSTEM', `${COLOR.red}Error deleting reminder in local DB: ${error.message}`);
			}
		}
	}
}

async function updateReminderTime(id, nextTimeMs) {
	if (pool) {
		try {
			await pool.query('UPDATE reminders SET reminder_time = $2 WHERE id = $1', [id, nextTimeMs]);
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in updateReminderTime: ${error.message}`);
		}
	}
	else {
		const filePath = REMINDERS_FILE;
		if (fs.existsSync(filePath)) {
			try {
				const reminders = JSON.parse(fs.readFileSync(filePath, 'utf8'));
				const rem = reminders.find(r => r.id === id);
				if (rem) {
					rem.reminder_time = nextTimeMs;
					fs.writeFileSync(filePath, JSON.stringify(reminders, null, 2), 'utf8');
				}
			}
			catch (error) {
				BotLogs('SYSTEM', `${COLOR.red}Error updating reminder time in local DB: ${error.message}`);
			}
		}
	}
}

async function clearAllReminders() {
	if (pool) {
		try {
			await pool.query('DELETE FROM reminders');
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in clearAllReminders: ${error.message}`);
		}
	}
	else {
		const filePath = REMINDERS_FILE;
		if (fs.existsSync(filePath)) {
			try {
				fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
			}
			catch (error) {
				BotLogs('SYSTEM', `${COLOR.red}Error clearing reminders in local DB: ${error.message}`);
			}
		}
	}
}

async function getAllAutoModConfigs() {
	const automodMap = new Map();
	if (pool) {
		try {
			const res = await pool.query(
				"SELECT guild_id, variables->'automod' AS automod_cfg FROM guild_variables WHERE variables->'automod' IS NOT NULL",
			);
			for (const row of res.rows) {
				if (row.automod_cfg) {
					automodMap.set(row.guild_id, row.automod_cfg);
				}
			}
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in getAllAutoModConfigs: ${error.message}`);
		}
	}
	else {
		try {
			if (fs.existsSync(VARS_DIR)) {
				const files = fs.readdirSync(VARS_DIR).filter(file => file.endsWith('.json'));
				for (const file of files) {
					const guildId = path.basename(file, '.json');
					const rawData = fs.readFileSync(path.join(VARS_DIR, file), 'utf8');
					if (rawData.trim()) {
						const data = JSON.parse(rawData);
						if (data.automod) {
							automodMap.set(guildId, data.automod);
						}
					}
				}
			}
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Error initializing automod cache (local): ${error.message}`);
		}
	}
	return automodMap;
}

async function cleanOldAuditLogs(retentionDays = 7) {
	const days = Math.max(parseInt(retentionDays || 7, 10), 1);
	if (pool) {
		try {
			const res = await pool.query(
				"DELETE FROM audit_logs WHERE created_at < NOW() - (INTERVAL '1 day' * $1)",
				[days]
			);
			if (res.rowCount > 0) {
				BotLogs('Database', `${COLOR.green}Purged ${COLOR.white}${res.rowCount}${COLOR.green} expired audit log entries (> ${days} days)`);
			}
			return res.rowCount || 0;
		}
		catch (error) {
			BotLogs('Database', `${COLOR.red}Error purging audit logs: ${error.message}`);
			return 0;
		}
	}
	return 0;
}

const auditCleanupInterval = setInterval(
	() => cleanOldAuditLogs(7).catch(() => undefined),
	24 * 60 * 60 * 1000,
);
// A maintenance timer must not keep short-lived test and CLI processes alive.
// The web and bot servers have their own handles, so unref does not stop this
// from running in production.
auditCleanupInterval.unref();

async function logAuditEvent(guildId, actionType, userId = null, userName = null, details = null, guildName = null) {
	if (!isValidSnowflake(guildId)) return;

	const eventType = actionType || 'GENERAL';
	const userTag = userName || 'System';
	const timestamp = new Date().toISOString();

	const category = eventType.startsWith('WEB') ? 'Web' : eventType.startsWith('AUTOMOD') ? 'AutoMod' : 'Bot';

	BotLogs(category, `${COLOR.white}${userTag}${COLOR.reset} executed ${COLOR.cyan}${eventType}${COLOR.reset}: ${details || ''} ${COLOR.gray}(${guildName || guildId})`);

	if (pool) {
		try {
			await pool.query(
				'INSERT INTO audit_logs (guild_id, guild_name, event_type, action_type, user_id, username, details, created_at) VALUES ($1, $2, $3, $3, $4, $5, $6, $7)',
				[guildId, guildName || 'Discord Server', eventType, userId, userTag, details, timestamp]
			);
			if (guildName && guildName !== 'Discord Server' && guildName !== guildId) {
				await pool.query(
					"UPDATE audit_logs SET guild_name = $1 WHERE guild_id = $2 AND (guild_name IS NULL OR guild_name = $2 OR guild_name = 'Discord Server')",
					[guildName, guildId]
				).catch(() => undefined);
			}
		}
		catch (error) {
			BotLogs('Database', `${COLOR.red}Database error in logAuditEvent: ${error.message}`);
		}
	}
}

async function getGuildAuditLogs(guildId, limit = 50, filterType = null) {
	if (!isValidSnowflake(guildId)) return [];

	if (pool) {
		try {
			let query = 'SELECT * FROM audit_logs WHERE guild_id = $1';
			const params = [guildId];

			if (filterType && filterType !== 'ALL') {
				if (filterType === 'MEMBER_BAN') {
					query += " AND (event_type IN ('MEMBER_BAN', 'MEMBER_UNBAN') OR action_type IN ('MEMBER_BAN', 'MEMBER_UNBAN'))";
				} else if (filterType === 'ROLE_UPDATE') {
					query += " AND (event_type IN ('ROLE_UPDATE', 'ROLE_CREATE', 'ROLE_DELETE') OR action_type IN ('ROLE_UPDATE', 'ROLE_CREATE', 'ROLE_DELETE'))";
				} else if (filterType === 'ROLE_ASSIGN') {
					query += " AND (event_type IN ('ROLE_ASSIGN', 'AUTOROLE', 'AUTOROLE_ASSIGN') OR action_type IN ('ROLE_ASSIGN', 'AUTOROLE', 'AUTOROLE_ASSIGN'))";
				} else if (filterType === 'CHANNEL_UPDATE') {
					query += " AND (event_type IN ('CHANNEL_UPDATE', 'CHANNEL_CREATE', 'CHANNEL_DELETE') OR action_type IN ('CHANNEL_UPDATE', 'CHANNEL_CREATE', 'CHANNEL_DELETE'))";
				} else if (filterType === 'INVITE_CREATE') {
					query += " AND (event_type IN ('INVITE_CREATE', 'INVITE_DELETE') OR action_type IN ('INVITE_CREATE', 'INVITE_DELETE'))";
				} else if (filterType === 'AUTOMOD') {
					query += " AND (event_type LIKE 'AUTOMOD%' OR action_type LIKE 'AUTOMOD%')";
				} else if (filterType === 'REACTION_ROLE') {
					query += " AND (event_type LIKE 'REACTION_ROLE%' OR action_type LIKE 'REACTION_ROLE%')";
				} else if (filterType === 'NICKNAME') {
					query += " AND (event_type LIKE 'NICKNAME%' OR action_type LIKE 'NICKNAME%')";
				} else {
					query += ' AND (event_type = $2 OR action_type = $2)';
					params.push(filterType);
				}
			}
			query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
			params.push(limit);

			const res = await pool.query(query, params);
			return res.rows;
		}
		catch (error) {
			BotLogs('Database', `${COLOR.red}Database error in getGuildAuditLogs: ${error.message}`);
			return [];
		}
	}
	return [];
}

async function getGlobalAuditLogs(limit = 100, filterType = null, guildSearch = null) {
	if (pool) {
		try {
			let query = 'SELECT * FROM audit_logs WHERE 1=1';
			const params = [];

			if (filterType && filterType !== 'ALL') {
				params.push(filterType);
				query += ` AND (event_type = $${params.length} OR action_type = $${params.length})`;
			}

			if (guildSearch && typeof guildSearch === 'string' && guildSearch.trim()) {
				params.push(`%${guildSearch.trim()}%`);
				query += ` AND (guild_name ILIKE $${params.length} OR guild_id ILIKE $${params.length})`;
			}

			params.push(limit);
			query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

			const res = await pool.query(query, params);
			return res.rows;
		}
		catch (error) {
			BotLogs('Database', `${COLOR.red}Database error in getGlobalAuditLogs: ${error.message}`);
			return [];
		}
	}
	return [];
}

async function getDeveloperUserIds() {
	if (pool) {
		try {
			const res = await pool.query('SELECT user_id FROM developer_users');
			return res.rows.map(r => String(r.user_id));
		}
		catch {
			return [];
		}
	}
	return [];
}

async function addDeveloperUser(userId, username = null) {
	if (!isValidSnowflake(userId)) return false;
	if (pool) {
		try {
			await pool.query(
				'INSERT INTO developer_users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET username = COALESCE($2, developer_users.username)',
				[String(userId), username]
			);
			return true;
		}
		catch (err) {
			BotLogs('Database', `Error adding developer user: ${err.message}`);
			return false;
}
	}
	return false;
}

async function removeDeveloperUser(userId) {
	if (!isValidSnowflake(userId)) return false;
	if (pool) {
		try {
			await pool.query('DELETE FROM developer_users WHERE user_id = $1', [String(userId)]);
			return true;
		}
		catch (err) {
			BotLogs('Database', `Error removing developer user: ${err.message}`);
			return false;
		}
	}
	return false;
}

async function logAudioEvent({ itemId, guildId, guildName, userName, text, engine, voice, lang, status = 'ENQUEUED', errorMessage = null } = {}) {
	if (!guildId || !text) return;
	if (pool) {
		try {
			await pool.query(
				`INSERT INTO audio_logs (item_id, guild_id, guild_name, user_name, text, engine, voice, lang, status, error_message, created_at, updated_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
				[itemId || null, guildId, guildName || 'Discord Server', userName || 'System', text, engine || 'EDGE_TTS', voice || 'th-TH-NiwatNeural', lang || 'th', status, errorMessage]
			);
		}
		catch (error) {
			BotLogs('Database', `${COLOR.red}Database error in logAudioEvent: ${error.message}`);
		}
	}
}

async function updateAudioStatus(itemId, status, errorMessage = null) {
	if (!itemId || !status) return;
	if (pool) {
		try {
			await pool.query(
				`UPDATE audio_logs SET status = $1, error_message = COALESCE($2, error_message), updated_at = CURRENT_TIMESTAMP
				 WHERE item_id = $3 AND (status NOT IN ('SKIPPED', 'REMOVED', 'CLEARED') OR $1 IN ('SKIPPED', 'REMOVED', 'CLEARED'))`,
				[status, errorMessage, itemId]
			);
		}
		catch (error) {
			BotLogs('Database', `${COLOR.red}Database error in updateAudioStatus: ${error.message}`);
		}
	}
}

async function getAudioLogs({ limit = 50, status = 'ALL', search = null, guildId = null } = {}) {
	if (pool) {
		try {
			// Auto-resolve any audio logs stuck at PLAYING for more than 15 seconds
			await pool.query(
				"UPDATE audio_logs SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE status = 'PLAYING' AND updated_at < NOW() - INTERVAL '15 seconds'"
			).catch(() => undefined);

			let query = 'SELECT * FROM audio_logs WHERE 1=1';
			const params = [];

			if (guildId) {
				params.push(guildId);
				query += ` AND guild_id = $${params.length}`;
			}

			if (status && status !== 'ALL') {
				params.push(status);
				query += ` AND status = $${params.length}`;
			}

			if (search && typeof search === 'string' && search.trim()) {
				params.push(`%${search.trim()}%`);
				query += ` AND (guild_name ILIKE $${params.length} OR guild_id ILIKE $${params.length} OR user_name ILIKE $${params.length} OR text ILIKE $${params.length})`;
			}

			const parsedLimit = Math.min(parseInt(limit || '50', 10), 200);
			params.push(parsedLimit);
			query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

			const res = await pool.query(query, params);
			return res.rows;
		}
		catch (error) {
			BotLogs('Database', `${COLOR.red}Database error in getAudioLogs: ${error.message}`);
			return [];
		}
	}
	return [];
}

async function cleanOldAudioLogs(retentionDays = 7) {
	if (pool) {
		try {
			const res = await pool.query(
				"DELETE FROM audio_logs WHERE created_at < NOW() - ($1 || ' days')::INTERVAL",
				[retentionDays]
			);
			return res.rowCount || 0;
		}
		catch (error) {
			BotLogs('Database', `${COLOR.red}Error cleaning old audio logs: ${error.message}`);
			return 0;
		}
	}
	return 0;
}

module.exports = {
	initDatabase,
	get isPostgres() {
		return !!pool;
	},
	isPostgresConnected: () => !!pool,
	getGuildVar,
	getAllGuildVars,
	setGuildVar,
	deleteGuildVar,
	getUserNick,
	setUserNick,
	getAnnounceOptOut,
	setAnnounceOptOut,
	getAllGuildNicks,
	deleteUserNick,
	getAllHoneypots,
	getAllTtsChannels,
	getAllAutoModConfigs,
	addReminder,
	getActiveReminders,
	deleteReminder,
	updateReminderTime,
	clearAllReminders,
	logAuditEvent,
	getGuildAuditLogs,
	getGlobalAuditLogs,
	cleanOldAuditLogs,
	getDeveloperUserIds,
	addDeveloperUser,
	removeDeveloperUser,
	logAudioEvent,
	updateAudioStatus,
	getAudioLogs,
	cleanOldAudioLogs,
};
