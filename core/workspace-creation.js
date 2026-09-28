const crypto = require('node:crypto');

function creationKey(value, required = false) {
	if (value === undefined && !required) return null;
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,160}$/.test(value)) {
		throw Object.assign(new Error('idempotency_key_invalid'), { code: 'idempotency_key_invalid' });
	}
	return value;
}

async function withCreationReceipt(client, { key, actorId, kind, payload }, create, authorizeReplay) {
	if (!key) return create(); // Internal callers without a logical retry contract.
	const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
	await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`workspace-creation:${key}`]);
	const prior = (await client.query('SELECT * FROM workspace_creations WHERE request_key=$1', [key])).rows[0];
	if (prior && (prior.actor_id !== actorId || prior.kind !== kind || prior.request_hash !== hash)) {
		throw Object.assign(new Error('idempotency_conflict'), { code: 'idempotency_conflict' });
	}
	if (!(await client.query('SELECT id FROM users WHERE id=$1', [actorId])).rows[0]) {
		throw Object.assign(new Error('creation_actor_unavailable'), { code: 'creation_actor_unavailable' });
	}
	if (prior) { await authorizeReplay(prior.result); return prior.result; }
	// Match the persisted JSON representation, including PostgreSQL Date values.
	const result = JSON.parse(JSON.stringify(await create()));
	await client.query('INSERT INTO workspace_creations(request_key,actor_id,kind,request_hash,result) VALUES ($1,$2,$3,$4,$5)',
		[key, actorId, kind, hash, JSON.stringify(result)]);
	return result;
}

module.exports = { creationKey, withCreationReceipt };
