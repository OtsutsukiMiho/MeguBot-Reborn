const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { BotLogs, COLOR } = require('./bot_functions.js');

const VARS_DIR = './database/variables';
const NICK_DIR = './database/nick';

let pool = null;

if (process.env.DATABASE_URL) {
	pool = new Pool({
		connectionString: process.env.DATABASE_URL,
		ssl: {
			rejectUnauthorized: false,
		},
	});
}

async function initDatabase() {
	if (pool) {
		try {
			const client = await pool.connect();
			BotLogs('SYSTEM', `${COLOR.green}Connected to PostgreSQL database!`);

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
			await client.query(`
				CREATE TABLE IF NOT EXISTS reminders (
					id SERIAL PRIMARY KEY,
					user_id VARCHAR(30) NOT NULL,
					guild_id VARCHAR(30) NOT NULL,
					channel_id VARCHAR(30) NOT NULL,
					reminder_time BIGINT NOT NULL,
					message TEXT NOT NULL,
					triggered BOOLEAN DEFAULT FALSE,
					recurring BOOLEAN DEFAULT FALSE
				);
			`);
			await client.query(`
				ALTER TABLE reminders ADD COLUMN IF NOT EXISTS recurring BOOLEAN DEFAULT FALSE;
			`).catch(() => undefined);
			client.release();
			BotLogs('SYSTEM', `${COLOR.green}PostgreSQL tables verified/created successfully.`);
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Failed to connect to PostgreSQL: ${error.message}. Falling back to local JSON database.`);
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
		BotLogs('SYSTEM', `${COLOR.blue}Using local JSON file-based database.`);
	}
}

async function getGuildVar(guildId, key) {
	if (pool) {
		try {
			const res = await pool.query(
				'SELECT variables->>$2 AS val FROM guild_variables WHERE guild_id = $1',
				[guildId, key],
			);
			if (res.rows.length > 0 && res.rows[0].val !== null) {
				return res.rows[0].val;
			}
			return null;
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in getGuildVar: ${error.message}`);
			return null;
		}
	}
	else {
		const dbPath = path.join(VARS_DIR, `${guildId}.json`);
		if (fs.existsSync(dbPath)) {
			try {
				const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
				return data[key] !== undefined ? data[key] : null;
			}
			catch {
				return null;
			}
		}
		return null;
	}
}

async function setGuildVar(guildId, key, value) {
	if (pool) {
		try {
			await pool.query(
				`INSERT INTO guild_variables (guild_id, variables)
				 VALUES ($1, jsonb_build_object($2::text, $3::text))
				 ON CONFLICT (guild_id) DO UPDATE
				 SET variables = jsonb_set(COALESCE(guild_variables.variables, '{}'::jsonb), ARRAY[$2::text], to_jsonb($3::text))`,
				[guildId, key, value],
			);
		}
		catch (error) {
			BotLogs('SYSTEM', `${COLOR.red}Database error in setGuildVar: ${error.message}`);
		}
	}
	else {
		const dbPath = path.join(VARS_DIR, `${guildId}.json`);
		let guildData = {};
		if (fs.existsSync(dbPath)) {
			try {
				guildData = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
			}
			catch {
				// Ignore
			}
		}
		guildData[key] = value;
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
		const filePath = './database/reminders.json';
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
		const filePath = './database/reminders.json';
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
		const filePath = './database/reminders.json';
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
		const filePath = './database/reminders.json';
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

module.exports = {
	initDatabase,
	getGuildVar,
	setGuildVar,
	deleteGuildVar,
	getUserNick,
	setUserNick,
	getAllHoneypots,
	getAllTtsChannels,
	addReminder,
	getActiveReminders,
	deleteReminder,
	updateReminderTime,
};
