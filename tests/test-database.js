const { Client } = require('pg');
const { domainToASCII } = require('node:url');
const { postgresConnectionOptions } = require('../core/postgres-connection.js');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'megu-db']);

function parseDatabaseUrl(value) {
	let url, options;
	try {
		options = postgresConnectionOptions(value, {});
		url = new URL(options.connectionString);
	}
	catch {
		throw new Error('The test database URL is not a valid PostgreSQL URL.');
	}

	const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
	// Use the installed driver's resolution, not the URI's apparent authority.
	// Ambiguous hosts and native-driver address/service selectors are unsupported.
	if (url.searchParams.getAll('host').length > 1 || ['hostaddr', 'service', 'servicefile'].some(key => url.searchParams.has(key))) {
		throw new Error('Tests require one unambiguous local PostgreSQL destination.');
	}
	const effective = new Client({ connectionString: url.toString(), ssl: false }).connectionParameters;
	if (effective.database !== database) {
		throw new Error('The effective test database must match the URL database name.');
	}
	const rawHost = effective.host;
	if (typeof rawHost !== 'string' || !/^[a-z0-9.:[\]-]+$/i.test(rawHost)) {
		throw new Error('The test database host is malformed.');
	}
	const host = domainToASCII(rawHost.includes(':') && !rawHost.startsWith('[') ? `[${rawHost}]` : rawHost)
		.replace(/^\[|\]$/g, '').replace(/\.$/, '');
	if (!LOCAL_HOSTS.has(host)) {
		throw new Error('Tests may only use a local PostgreSQL host.');
	}
	if (!/^[A-Za-z0-9_]+$/.test(database)) {
		throw new Error('The test database name may contain only letters, numbers, and underscores.');
	}
	// Pin the normalized host so every consumer uses exactly what was validated.
	url.searchParams.set('host', host);
	return { url, database, canonicalInput: rawHost === host && options.ssl === false };
}

function isDisposableTestDatabase(value) {
	try {
		const { database, canonicalInput } = parseDatabaseUrl(value);
		// Boolean-only consumers retain the input URL. Require it to be safe to
		// use unchanged; resolve/ensure can normalize additional local forms.
		return database.endsWith('_test') && canonicalInput;
	}
	catch {
		return false;
	}
}

function resolveTestDatabaseUrl(env = process.env) {
	const explicit = env.MEGU_TEST_DATABASE_URL;
	if (explicit) {
		let parsed;
		try { parsed = parseDatabaseUrl(explicit); } catch {}
		if (!parsed?.database.endsWith('_test')) {
			throw new Error('MEGU_TEST_DATABASE_URL must be local and its database name must end with `_test`.');
		}
		return parsed.url.toString();
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
	let parsed;
	try { parsed = parseDatabaseUrl(value); } catch {}
	if (!parsed?.database.endsWith('_test')) {
		throw new Error('Refusing to create or use a database whose name does not end with `_test`.');
	}

	const { url, database } = parsed;
	const adminUrl = new URL(url);
	adminUrl.pathname = '/postgres';
	const client = new Client(postgresConnectionOptions(adminUrl.toString()));
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
	return url.toString();
}

module.exports = {
	describeDatabase,
	ensureTestDatabase,
	isDisposableTestDatabase,
	resolveTestDatabaseUrl,
};
