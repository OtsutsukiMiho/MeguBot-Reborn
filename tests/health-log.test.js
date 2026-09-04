// The health log must never be the thing that breaks.
//
// It exists to describe an incident, and it is called from the two worst places
// in the system to fail: the supervisor's exit handler, and a bot on its way out
// of `client.login().catch()`. If a bad database connection could throw there,
// this file would turn a recoverable outage into a supervisor crash — and it
// would do it during the exact incident it was added to explain.
//
// So every check here is a way of failing, and the assertion is always the same
// two things: it returned false, and it did not throw. No database is needed or
// used; a reachable one is not this file's subject.

const assert = require('node:assert');
const healthLog = require('../adapters/health/health-log.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

/** Restored after each case, so one test cannot leak into the next. */
const REAL_URL = process.env.DATABASE_URL;

async function main() {
	console.log('\nrefusing bad input');

	{
		delete process.env.DATABASE_URL;

		assert.strictEqual(await healthLog.record({ kind: 'boot' }), false);
		assert.strictEqual(await healthLog.saveDiscordBlockUntil(Date.now() + 60_000), false);
		assert.strictEqual(await healthLog.loadDiscordBlockUntil(), 0);
		assert.strictEqual(await healthLog.clearDiscordBlock(), false);
		ok('no DATABASE_URL returns false rather than throwing');

		assert.strictEqual(await healthLog.record({ kind: 'nonsense' }), false);
		assert.strictEqual(await healthLog.record({}), false);
		assert.strictEqual(await healthLog.record(), false);
		ok('an unknown kind, an empty call and no call at all are all refused');

		// A closed set is only worth having if it is actually closed.
		for (const kind of healthLog.KINDS) {
			assert.strictEqual(typeof kind, 'string');
			assert.ok(kind.length > 0 && kind.length <= 40, `${kind} does not fit the column`);
		}
		ok('every declared kind fits the column it is stored in');
	}

	console.log('\na database that is not there');

	{
		// Port 1 is reserved and nothing listens on it, so this is a connection
		// failure rather than a slow query — the shape a dead database takes.
		process.env.DATABASE_URL = 'postgresql://nobody:nothing@127.0.0.1:1/megu';

		const startedAt = Date.now();
		let threw = null;
		let result = null;
		try {
			result = await healthLog.record({ kind: 'block', detail: 'while a database is unreachable' });
		}
		catch (error) {
			threw = error;
		}
		const elapsed = Date.now() - startedAt;

		assert.strictEqual(threw, null, `it threw: ${threw && threw.message}`);
		ok('an unreachable database does not throw');

		assert.strictEqual(result, false);
		ok('and says so, rather than reporting a write that never happened');

		// The supervisor awaits this on an exit path. A hang here is a process
		// that never exits, which is worse than the block it was describing.
		assert.ok(
			elapsed < healthLog.WRITE_TIMEOUT_MS * 3,
			`took ${elapsed}ms, which is too long to sit on an exit path`,
		);
		ok(`it gives up in ${elapsed}ms rather than holding an exit open`);

		// The failure must not be sticky: a database that comes back should be
		// usable again, so a cached rejection would silently disable this table.
		const second = await healthLog.record({ kind: 'exit', detail: 'a second attempt' });
		assert.strictEqual(second, false);
		ok('a second call after a failure still answers, and does not throw either');

		assert.strictEqual(await healthLog.saveDiscordBlockUntil(Date.now() + 60_000), false);
		assert.strictEqual(await healthLog.loadDiscordBlockUntil(), 0);
		assert.strictEqual(await healthLog.clearDiscordBlock(), false);
		ok('durable Discord cooldown state also fails open when the database is unavailable');

		await healthLog.close();
		ok('closing a pool that never connected is safe');
	}

	console.log('\nclosing');

	{
		// Called by short-lived processes that may never have written anything.
		await healthLog.close();
		await healthLog.close();
		ok('close is idempotent');
	}

	console.log(`\n${n} checks passed\n`);
}

main()
	.then(() => {
		if (REAL_URL === undefined) delete process.env.DATABASE_URL;
		else process.env.DATABASE_URL = REAL_URL;
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
