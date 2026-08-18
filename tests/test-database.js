const { Client } = require('pg');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', 'host.docker.internal', 'megu-db']);

function parseDatabaseUrl(value) {
	let url;
	try {
		url = new URL(value);
	}
	catch {
		throw new Error('The test database URL is not a valid PostgreSQL URL.');
	}

	const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
	if (!LOCAL_HOSTS.has(url.hostname)) {
		throw new Error(`Tests may only use a local PostgreSQL host, not ${url.hostname || 'an empty host'}.`);
	}
	if (!/^[A-Za-z0-9_]+$/.test(database)) {
		throw new Error('The test database name may contain only letters, numbers, and underscores.');
	}
	return { url, database };
}

function isDisposableTestDatabase(value) {
	try {
		const { database } = parseDatabaseUrl(value);
		return database.endsWith('_test');
	}
	catch {
		return false;
	}
}

function resolveTestDatabaseUrl(env = process.env) {
	const explicit = env.MEGU_TEST_DATABASE_URL;
	if (explicit) {
		if (!isDisposableTestDatabase(explicit)) {
			throw new Error('MEGU_TEST_DATABASE_URL must be local and its database name must end with `_test`.');
		}
		return explicit;
	}

	const source = env.MEGU_DATABASE_URL;
	if (!source) {
		throw new Error('MEGU_DATABASE_URL is required so the isolated test database can be derived.');
	}
	const { url, database } = parseDatabaseUrl(source);
	url.pathname = `/${database.endsWith('_test') ? database : `${database}_test`}`;
	return url.toString();
}

function describeDatabase(value) {
	const { url } = parseDatabaseUrl(value);
	if (url.password) url.password = '***';
	return url.toString();
}

async function ensureTestDatabase(value) {
	if (!isDisposableTestDatabase(value)) {
		throw new Error('Refusing to create or use a database whose name does not end with `_test`.');
	}

	const { url, database } = parseDatabaseUrl(value);
	const adminUrl = new URL(url);
	adminUrl.pathname = '/postgres';
	const client = new Client({ connectionString: adminUrl.toString(), ssl: false });
	await client.connect();
	try {
		const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
		if (existing.rowCount === 0) {
			// `database` is restricted to an identifier-safe character set above.
			await client.query(`CREATE DATABASE "${database}"`);
		}
	}
	finally {
		await client.end();
	}
	return value;
}

module.exports = {
	describeDatabase,
	ensureTestDatabase,
	isDisposableTestDatabase,
	resolveTestDatabaseUrl,
};
