'use strict';
const fs = require('node:fs');
const { X509Certificate } = require('node:crypto');

function databaseUrl(value) {
	let url;
	try { url = new URL(value); } catch { throw new Error('Invalid PostgreSQL connection URL.'); }
	if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error('Invalid PostgreSQL connection URL.');
	return url;
}

function isLocalDatabaseUrl(value) {
	const url = databaseUrl(value);
	// pg keeps the last duplicate query parameter, then falls back to the URL
	// host for an empty value. Classify the same effective connection target.
	const host = url.searchParams.getAll('host').at(-1) || url.hostname;
	return ['localhost', '127.0.0.1', '[::1]', '::1', 'host.docker.internal', 'megu-db'].includes(host);
}

function postgresConnectionOptions(value, env = process.env) {
	const url = databaseUrl(value);
	const local = isLocalDatabaseUrl(value);
	// pg reparses connectionString over explicit ssl options. Remove its TLS
	// switches so URL flags cannot disable chain or hostname verification.
	for (const key of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) url.searchParams.delete(key);
	// pg omits SNI for IP targets. Supply host so native TLS still validates the
	// actual database identity instead of falling back to "localhost".
	const ssl = local ? false : { rejectUnauthorized: true, host: url.searchParams.getAll('host').at(-1) || url.hostname };
	if (!local && env.MEGU_PG_CA_FILE !== undefined) {
		try {
			if (!env.MEGU_PG_CA_FILE.trim()) throw new Error('Missing CA path.');
			const ca = fs.readFileSync(env.MEGU_PG_CA_FILE, 'utf8');
			const blocks = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
			if (!blocks?.length || ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, '').trim()
				|| blocks.some(block => !new X509Certificate(block).ca)) throw new Error('Invalid CA bundle.');
			ssl.ca = ca;
		}
		catch { throw new Error('MEGU_PG_CA_FILE must name a readable PEM trusted-CA certificate bundle.'); }
	}
	return { connectionString: url.toString(), ssl };
}

module.exports = { postgresConnectionOptions, isLocalDatabaseUrl };
