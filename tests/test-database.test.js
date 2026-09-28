const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const { Client } = require('pg');
const {
	isDisposableTestDatabase,
	resolveTestDatabaseUrl,
	ensureTestDatabase,
} = require('./test-database.js');

const dev = 'postgresql://megu:secret@127.0.0.1:55432/megu_dev';
const derived = resolveTestDatabaseUrl({ MEGU_DATABASE_URL: dev });
assert.strictEqual(new URL(derived).pathname, '/megu_dev_test');
assert.strictEqual(isDisposableTestDatabase(derived), true);
assert.strictEqual(isDisposableTestDatabase(dev), false);
assert.strictEqual(isDisposableTestDatabase('postgresql://megu:secret@example.com/megu_test'), false);
assert.throws(
	() => resolveTestDatabaseUrl({ MEGU_TEST_DATABASE_URL: dev }),
	/must be local.*end with `_test`/,
);
assert.throws(
	() => resolveTestDatabaseUrl({ MEGU_TEST_DATABASE_URL: 'postgresql://megu:secret@example.com/megu_test' }),
	/must be local.*end with `_test`/,
);

console.log('  ok  dev URLs are derived to an isolated `_test` database');
console.log('  ok  destructive suites reject dev and remote database URLs');

async function main() {
	const accepted = [
		['localhost', 'localhost'], ['LOCALHOST', 'localhost'], ['localhost.', 'localhost'],
		['127.0.0.1', '127.0.0.1'], ['127.1', '127.0.0.1'], ['2130706433', '127.0.0.1'],
		['[::1]', '::1'], ['[0:0:0:0:0:0:0:1]', '::1'],
		['%6cocalhost', 'localhost'], ['host.docker.internal', 'host.docker.internal'], ['megu-db', 'megu-db'],
	];
	for (const [host, canonical] of accepted) {
		const url = `postgresql://test@${host}/fixture_test?sslmode=disable`;
		const resolved = resolveTestDatabaseUrl({ MEGU_TEST_DATABASE_URL: url });
		assert.equal(isDisposableTestDatabase(resolved), true, host);
		const original = new Client({ connectionString: url, ssl: false }).host;
		assert.equal(isDisposableTestDatabase(url), original === canonical && ['localhost', '127.0.0.1', 'host.docker.internal', 'megu-db'].includes(host), 'Boolean-only consumers reject inputs requiring normalization');
		const actual = new Client({ connectionString: resolved, ssl: false }).connectionParameters;
		assert.equal(actual.host, canonical, 'Consumed destination equals normalized validated destination');
		assert.equal(actual.ssl, false);
		assert.equal(new URL(resolved).searchParams.has('sslmode'), false);
	}
	for (const host of ['LOCALHOST', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1', '']) {
		const url = 'postgresql://test@localhost/fixture_test?host=' + encodeURIComponent(host);
		assert.equal(isDisposableTestDatabase(resolveTestDatabaseUrl({ MEGU_TEST_DATABASE_URL: url })), true);
	}
	const rejected = [
		'postgresql://test@db.example.test/fixture_test', 'postgresql://test@203.0.113.5/fixture_test',
		'postgresql://test@[2001:db8::1]/fixture_test',
		...['host=db.example.test', 'sslmode=disable&host=db.example.test', 'host=db.example.test&ssl=0',
			'host=localhost&host=db.example.test', 'host=db.example.test&host=localhost', 'host=localhost&host=',
			'%68ost=%64b.example.test', 'host=203.0.113.5', 'host=%2Ftmp', 'host=localhost%2Fremote',
			'host=remote%40localhost', 'host=localhost%00', 'host=%2531%2532%2537.0.0.1',
			'hostaddr=203.0.113.5', 'service=remote', 'servicefile=remote.conf']
			.map(query => 'postgresql://test@localhost/fixture_test?' + query),
		'https://localhost/fixture_test', 'postgresql:///fixture_test', 'postgresql://localhost/',
		'postgresql://test@%2Ftmp/fixture_test?host=localhost',
	];
	// Execute the real helper with a spy driver. Parsing is real; no connection
	// can start for a rejected target, including creation of the admin database.
	const connections = [], queries = [];
	class SpyClient extends Client {
		async connect() { connections.push(this.connectionParameters); }
		async query(sql, values) { queries.push({ sql, values }); return { rowCount: 1 }; }
		async end() {}
	}
	const module = { exports: {} };
	vm.runInNewContext(fs.readFileSync(require.resolve('./test-database.js'), 'utf8'), {
		module, URL, process,
		require: name => name === 'pg' ? { Client: SpyClient } : require(name),
	});
	for (const url of rejected) {
		assert.equal(isDisposableTestDatabase(url), false, url);
		assert.throws(() => resolveTestDatabaseUrl({ MEGU_TEST_DATABASE_URL: url }), /must be local/);
		assert.throws(() => resolveTestDatabaseUrl({ MEGU_DATABASE_URL: url }), 'Derived test URLs also reject effective remote/ambiguous/malformed destinations');
		await assert.rejects(module.exports.ensureTestDatabase(url), /Refusing/);
	}
	assert.equal(connections.length, 0, 'No remote/malformed target reaches connect');
	const resolved = await module.exports.ensureTestDatabase('postgresql://test@[::1]/fixture_test?ssl=no-verify&sslrootcert=missing');
	assert.equal(connections.length, 1);
	assert.equal(connections[0].host, '::1');
	assert.equal(connections[0].database, 'postgres');
	assert.equal(connections[0].ssl, false);
	assert.equal(queries[0].values[0], 'fixture_test');
	assert.equal(new URL(resolved).searchParams.has('sslrootcert'), false);
	const savedHost = process.env.PGHOST;
	try {
		process.env.PGHOST = 'db.example.test';
		assert.equal(isDisposableTestDatabase('postgresql://test@localhost/fixture_test?host='), true);
		assert.equal(new Client({ connectionString: resolveTestDatabaseUrl({ MEGU_TEST_DATABASE_URL: 'postgresql://test@localhost/fixture_test?host=' }) }).host, 'localhost');
	} finally { if (savedHost === undefined) delete process.env.PGHOST; else process.env.PGHOST = savedHost; }
	if (process.env.MEGU_TEST_DATABASE_URL) {
		const url = resolveTestDatabaseUrl();
		assert.equal(await ensureTestDatabase(url), url);
		const client = new Client({ connectionString: url, ssl: false });
		try { await client.connect(); assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name.endsWith('_test'), true); }
		finally { await client.end(); }
		console.log('  ok  native disposable runner database setup and connection');
	}
	console.log(`  ok  effective destination: ${accepted.length} local forms and ${rejected.length} remote/ambiguous/malformed denials; zero rejected connections`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
