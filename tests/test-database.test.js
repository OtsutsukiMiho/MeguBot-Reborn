const assert = require('node:assert');
const {
	constrainTestDatabaseEnv,
	describeDatabase,
	isDisposableTestDatabase,
	resolveTestDatabaseUrl,
} = require('./test-database.js');

const dev = 'postgresql://megu:secret@127.0.0.1:55432/megu_dev';
const derived = resolveTestDatabaseUrl({ MEGU_DATABASE_URL: dev });
assert.strictEqual(new URL(derived).pathname, '/megu_dev_test');
assert.strictEqual(isDisposableTestDatabase(derived), true);
assert.strictEqual(isDisposableTestDatabase(dev), false);
assert.strictEqual(isDisposableTestDatabase('postgresql://megu:secret@example.com/megu_test'), false);
assert.strictEqual(
	isDisposableTestDatabase('postgresql://megu:secret@127.0.0.1/megu_test?host=example.com'),
	false,
);
assert.strictEqual(isDisposableTestDatabase('socket://127.0.0.1/megu_test'), false);

const childEnv = {
	MEGU_DATABASE_URL: dev,
	// A production-style legacy value must be replaced before a child starts.
	DATABASE_URL: 'postgresql://megu:secret@example.com/megu_prod',
};
const childTestUrl = constrainTestDatabaseEnv(childEnv);
assert.strictEqual(childEnv.MEGU_DATABASE_URL, childTestUrl);
assert.strictEqual(childEnv.DATABASE_URL, childTestUrl);
assert.strictEqual(new URL(childTestUrl).hostname, '127.0.0.1');
assert.strictEqual(new URL(childTestUrl).pathname, '/megu_dev_test');
assert.strictEqual(isDisposableTestDatabase(childEnv.DATABASE_URL), true);

assert.throws(
	() => resolveTestDatabaseUrl({ MEGU_TEST_DATABASE_URL: dev }),
	/must be local.*end with `_test`/,
);
assert.throws(
	() => resolveTestDatabaseUrl({ MEGU_TEST_DATABASE_URL: 'postgresql://megu:secret@example.com/megu_test' }),
	/must be local.*end with `_test`/,
);
assert.throws(
	() => constrainTestDatabaseEnv({ MEGU_TEST_DATABASE_URL: 'postgresql://megu:secret@example.com/megu_prod' }),
	/must be local.*end with `_test`/,
);
const invalidChildEnv = {
	MEGU_DATABASE_URL: dev,
	DATABASE_URL: 'postgresql://megu:secret@example.com/megu_prod',
	MEGU_TEST_DATABASE_URL: 'postgresql://megu:secret@example.com/megu_prod',
};
assert.throws(
	() => constrainTestDatabaseEnv(invalidChildEnv),
	/must be local.*end with `_test`/,
);
assert.strictEqual(invalidChildEnv.MEGU_DATABASE_URL, dev);
assert.strictEqual(invalidChildEnv.DATABASE_URL, 'postgresql://megu:secret@example.com/megu_prod');
assert.strictEqual(invalidChildEnv.MEGU_TEST_DATABASE_URL, 'postgresql://megu:secret@example.com/megu_prod');
assert.throws(
	() => describeDatabase('postgresql://megu:secret@127.0.0.1/megu_test?host=example.com'),
	/host.*query parameter/,
);
assert.throws(
	() => describeDatabase('socket://127.0.0.1/megu_test'),
	/must use the PostgreSQL protocol/,
);

console.log('  ok  dev URLs are derived to an isolated `_test` database');
console.log('  ok  core and legacy child URLs are both constrained to the local `_test` database');
console.log('  ok  destructive suites reject dev, remote, non-PostgreSQL, and query-host URLs');
