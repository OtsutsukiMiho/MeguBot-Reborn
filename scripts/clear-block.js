/**
 * Clear Persisted Discord Rate-Limit Cooldown from Database
 * Usage: node scripts/clear-block.js
 */

require('dotenv').config();
const healthLog = require('../adapters/health/health-log.js');

async function main() {
	console.log('🔄 Checking persisted Discord rate-limit block state...');

	const until = await healthLog.loadDiscordBlockUntil();
	if (until > Date.now()) {
		const remainingMin = Math.ceil((until - Date.now()) / 60000);
		console.log(`⚠️ Found active cooldown: ${remainingMin} minute(s) remaining (until ${new Date(until).toLocaleTimeString()}).`);
	}
	else {
		console.log('ℹ️ No active cooldown found in database.');
	}

	console.log('🧹 Clearing cooldown from database...');
	const cleared = await healthLog.clearDiscordBlock();

	if (cleared) {
		console.log('✅ Cooldown successfully deleted from database!');
	}
	else {
		console.log('✅ Database state cleared or already empty.');
	}

	await healthLog.close();
	console.log('👉 Please restart your bot (node index.js) now to start with a clean state.\n');
	process.exit(0);
}

main().catch(err => {
	console.error('❌ Error clearing cooldown:', err);
	process.exit(1);
});
