// Rebuild the authorized Discord E2E fixture after a local test reset, replay
// the synthetic slip through the production reader, then leave the payment in
// the owner-reversed state that the browser flow is expected to produce.
require('dotenv').config();
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const core = require('../core/index.js');
const { readDiscordSlip, stampWhen } = require('../adapters/discord/payment-evidence.js');

async function findDiscordUserId(username, guildId) {
	console.log(`Looking up Discord test member ${username}...`);
	const query = new URLSearchParams({ query: username, limit: '20' });
	const members = await new Promise((resolve, reject) => {
		const request = https.request({
			hostname: 'discord.com',
			path: `/api/v10/guilds/${guildId}/members/search?${query}`,
			method: 'GET',
			headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` },
		}, response => {
			const chunks = [];
			response.on('data', chunk => chunks.push(chunk));
			response.on('end', () => {
				const body = Buffer.concat(chunks).toString('utf8');
				if (response.statusCode < 200 || response.statusCode >= 300) {
					return reject(new Error(`Discord member lookup returned HTTP ${response.statusCode}.`));
				}
				try { resolve(JSON.parse(body)); }
				catch { reject(new Error('Discord member lookup returned invalid JSON.')); }
			});
		});
		request.on('error', reject);
		request.end();
	});
	console.log(`Discord returned ${members.length} matching member(s).`);
	const needle = username.toLocaleLowerCase('en-US');
	const exact = members.filter(member => [member.user.username, member.user.global_name]
		.filter(Boolean)
		.some(value => value.toLocaleLowerCase('en-US') === needle));
	if (exact.length !== 1) {
		throw new Error(`Expected exactly one Discord member named ${username}; found ${exact.length}.`);
	}
	return exact[0].user.id;
}

function seedFixture(discordUid, guildId, channelId) {
	console.log('Rebuilding the local Discord payment fixture...');
	const seed = spawnSync(process.execPath, [
		path.join(__dirname, 'seed-discord-payment-test.js'),
		discordUid,
		guildId,
		channelId,
	], {
		cwd: path.join(__dirname, '..'),
		env: process.env,
		encoding: 'utf8',
	});
	if (seed.status !== 0) throw new Error(seed.stderr.trim() || 'Discord payment fixture seed failed.');
	const json = seed.stdout.split(/\r?\n/).find(line => line.trim().startsWith('{'));
	if (!json) throw new Error('Discord payment fixture seed returned no activity.');
	return JSON.parse(json);
}

async function main() {
	const [approval, username, guildId, channelId, imagePath, ...reasonParts] = process.argv.slice(2);
	console.log('Starting Discord payment fixture restore.');
	if (approval !== '--replace-fixture') {
		throw new Error('Refusing to replace the reserved fixture without the explicit `--replace-fixture` flag.');
	}
	if (!username) throw new Error('Discord username is required.');
	if (!/^\d{16,22}$/.test(guildId || '')) throw new Error('guild id is required.');
	if (!/^\d{16,22}$/.test(channelId || '')) throw new Error('channel id is required.');
	if (!imagePath) throw new Error('synthetic slip path is required.');
	const reason = reasonParts.join(' ').trim() || 'owner reversed the synthetic E2E payment';

	const discordUid = await findDiscordUserId(username, guildId);
	const fixture = seedFixture(discordUid, guildId, channelId);
	await core.initCoreSchema();
	const found = await core.activities.listPaymentCandidatesForDiscord(discordUid, guildId, fixture.code);
	if (found.length !== 1) throw new Error(`Expected one payment candidate for ${fixture.code}; found ${found.length}.`);
	const candidate = found[0];
	const amountSatang = candidate.outstandingSatang;
	const allocation = core.paymentEvidence.allocateOldestFirst(amountSatang, candidate.periods);
	if (allocation.unallocatedSatang !== 0) throw new Error('The fixture amount could not be allocated exactly.');

	const image = await fs.readFile(path.resolve(imagePath));
	const reading = await readDiscordSlip(image);
	const payment = await core.activities.recordPayment(candidate.activityId, candidate.participantId, {
		amountSatang,
		method: 'bank_transfer',
		expectedSatang: amountSatang,
		promptpayTarget: candidate.payee.promptpayId,
		allocations: allocation.allocations,
	});
	const attached = await core.activities.attachSlip(payment.id, {
		image: reading.normalizedImage,
		mime: reading.normalizedMime,
		evidenceImage: reading.evidenceImage,
		evidenceMime: reading.evidenceImage ? 'image/png' : null,
		evidenceHash: reading.evidenceImage
			? crypto.createHash('sha256').update(reading.evidenceImage).digest('hex')
			: null,
		ref: reading.slip?.ref || null,
		bank: reading.slip?.bank?.code || null,
		amountSatang: reading.read.amountSatang,
		when: stampWhen(reading.read.when),
		senderName: reading.read.parties?.sender?.name || null,
		receiverName: reading.read.parties?.receiver?.name || null,
		senderAccountTail: reading.read.parties?.sender?.accountTail || null,
		receiverAccountTail: reading.read.parties?.receiver?.accountTail || null,
		expectedReceiverName: candidate.payee.promptpayName,
	});
	if (!attached.autoConfirmed) throw new Error(`Synthetic slip did not auto-confirm: ${attached.reasons.join(', ')}`);
	await core.activities.reversePayment(payment.id, candidate.ownerUserId, reason);

	const verified = await core.db.query(
		`SELECT p.status, p.amount_satang, p.slip_verdict, p.slip_image IS NULL AS raw_deleted,
		        p.evidence_image IS NOT NULL AS evidence_kept,
		        p.reversal_reason, count(pa.id)::int AS allocations
		 FROM payments p
		 LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
		 WHERE p.id = $1
		 GROUP BY p.id`,
		[payment.id],
	);
	const row = verified.rows[0];
	console.log(JSON.stringify({
		code: fixture.code,
		url: `/a/${fixture.code}`,
		status: row.status,
		amountSatang: Number(row.amount_satang),
		slipVerdict: row.slip_verdict,
		rawDeleted: row.raw_deleted,
		evidenceKept: row.evidence_kept,
		allocations: row.allocations,
		reversalReason: row.reversal_reason,
	}));
}

// Discord's REST client uses unref'd request timers, so a tiny referenced timer
// keeps this one-shot CLI alive until the awaited lookup has settled.
const keepAlive = setInterval(() => undefined, 1000);
main()
	.then(() => core.db.close())
	.catch(async (error) => {
		console.error(error.message);
		await core.db.close().catch(() => undefined);
		process.exitCode = 1;
	})
	.finally(() => clearInterval(keepAlive));
