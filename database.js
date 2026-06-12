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

module.exports = {
	initDatabase,
	getGuildVar,
	setGuildVar,
	deleteGuildVar,
	getUserNick,
	setUserNick,
	getAllHoneypots,
	getAllTtsChannels,
};
