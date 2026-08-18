const assert = require('node:assert');
const {
	isDisposableTestDatabase,
	resolveTestDatabaseUrl,
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
