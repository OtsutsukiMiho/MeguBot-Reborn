'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const tls = require('node:tls');
const net = require('node:net');
const { execFileSync, spawnSync } = require('node:child_process');
const { Client } = require('pg');
const policy = require('../core/postgres-connection');
const remote = 'postgresql://test@db.example.test/test';

async function captureOperator(file, env, args = [], complete = false) {
	const options = [], errors = [], queries = [], module = { exports: {} };
	let ended = false;
	class Connection {
		constructor(config) { options.push(config); }
		// Pause before network I/O; executing the actual CLI must select its policy first.
		connect() { return complete ? Promise.resolve({
			query: async sql => { queries.push(sql); return { rows: sql.includes('to_regclass') ? [{ t: null }] : [] }; },
			release() {},
		}) : new Promise(() => {}); }
		async end() { ended = true; }
	}
	const localRequire = require('node:module').createRequire(require.resolve(file));
	const mockedRequire = name => {
		if (name === 'pg') return { Pool: Connection, Client: Connection };
		if (name === 'dotenv') return { config() {} };
		if (name.endsWith('/postgres-connection.js')) return { postgresConnectionOptions: value => policy.postgresConnectionOptions(value, env) };
		return localRequire(name);
	};
	mockedRequire.main = module;
	const source = fs.readFileSync(require.resolve(file), 'utf8');
	try { vm.runInNewContext(file.endsWith('.sh') ? source.match(/node -e "\r?\n([\s\S]*?)\r?\n"/)[1] : source, {
		module, URL, require: mockedRequire, console: { log() {}, error: value => errors.push(value) },
		process: { env, argv: ['node', file, ...args], exit() {}, exitCode: 0 },
	}); } catch (error) { errors.push(error.message); }
	await new Promise(resolve => setImmediate(resolve));
	return { options, errors, queries, ended };
}

function capturePool(file, env) {
	const options = [], module = { exports: {} };
	class Pool {
		constructor(config) { options.push(config); }
		on() {}
		query() { throw new Error('Pool policy captured without a database connection.'); }
		connect() { return Promise.reject(Object.assign(new Error('Untrusted test certificate'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })); }
	}
	vm.runInNewContext(fs.readFileSync(require.resolve(file), 'utf8'), {
		module, process: { env }, __dirname: path.dirname(require.resolve(file)), console,
		setInterval: () => ({ unref() {} }), clearInterval: () => {},
		require: name => {
			if (name === 'pg') return { Pool };
			if (name.endsWith('/postgres-connection.js')) return { ...policy, postgresConnectionOptions: value => policy.postgresConnectionOptions(value, env) };
			if (name.endsWith('/pool-config.js')) return { poolMax: () => 1 };
			if (name.endsWith('/bot_functions.js')) return { BotLogs: () => {}, COLOR: {} };
			if (name === './log.js') return { log: () => {} };
			return require(name);
		},
	});
	return { options, exports: module.exports };
}

function openssl() {
	const candidates = [process.env.MEGU_OPENSSL_BIN, 'openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', '/usr/bin/openssl'].filter(Boolean);
	for (const candidate of candidates) if (spawnSync(candidate, ['version'], { stdio: 'ignore' }).status === 0) return candidate;
	throw new Error('OpenSSL is required for the ephemeral TLS regression fixture (MEGU_OPENSSL_BIN may specify it).');
}

async function main() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'megu-pg-tls-'));
	let server;
	try {
		const executable = openssl();
		const run = args => execFileSync(executable, args, { cwd: dir, stdio: 'ignore' });
		run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-subj', '/CN=Megu Ephemeral Test CA', '-addext', 'basicConstraints=critical,CA:TRUE']);
		run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=db.example.test']);
		fs.writeFileSync(path.join(dir, 'extensions'), 'subjectAltName=DNS:db.example.test,DNS:localhost,IP:203.0.113.5\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n');
		run(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'extensions']);
		const caPath = path.join(dir, 'ca.pem'), env = { MEGU_PG_CA_FILE: caPath };
		const trusted = policy.postgresConnectionOptions(remote, env);
		const operators = [
			['../scripts/health-log', 'DATABASE_URL', []],
			['../scripts/instance-audit', 'DATABASE_URL', []],
			['../scripts/company-retirement-preflight', 'MEGU_COMPANY_INVENTORY_DATABASE_URL', ['--authorized-retained-inventory']],
			['../scripts/company-retirement-rehearsal', 'MEGU_TEST_DATABASE_URL', ['actor', 'company']],
			['../scripts/cloud-setup.sh', 'MEGU_DATABASE_URL', []],
		];
		for (const [file, variable, args] of operators) {
			if (file.endsWith('rehearsal')) {
				for (const suffix of ['host=db.example.test', 'host=db.example.test&sslmode=disable', 'host=localhost&host=db.example.test']) {
					const rejected = await captureOperator(file, { ...env, [variable]: 'postgresql://test@localhost/fixture_test?' + suffix }, args);
					assert.equal(rejected.options.length, 0, 'Rehearsal now rejects effective remote targets before constructing its connection');
					assert.match(rejected.errors[0], /retirement_rehearsal_local_test_only/);
				}
				const local = await captureOperator(file, { [variable]: 'postgresql://test@127.0.0.1/fixture_test?sslmode=disable' }, args);
				assert.equal(new Client(local.options[0]).connectionParameters.ssl, false);
				assert.equal(local.options[0].connectionTimeoutMillis, 5000);
				continue;
			}
			// Cloud's separate authority guard still permits this effective remote host;
			// its shared TLS policy must authenticate it. Company test guards reject it.
			const target = file.endsWith('rehearsal') || file.endsWith('.sh') ? 'postgresql://test@localhost/fixture_test?host=db.example.test&' : remote + '?';
			for (const suffix of ['', 'sslmode=disable', 'ssl=0', 'ssl=no-verify', 'sslmode=no-verify', 'uselibpqcompat=true&sslmode=require', 'sslrootcert=missing&sslcert=missing&sslkey=missing']) {
				const captured = await captureOperator(file, { ...env, [variable]: target + suffix }, args);
				assert.deepEqual(captured.errors, [], file);
				assert.equal(captured.options.length, 1, file);
				const actual = new Client(captured.options[0]).connectionParameters;
				assert.equal(actual.host, 'db.example.test');
				assert.equal(actual.ssl.rejectUnauthorized, true, `${file}: ${suffix} cannot select plaintext/unverified TLS`);
				assert.equal(actual.ssl.host, actual.host);
				assert.equal(actual.ssl.ca, trusted.ssl.ca);
				assert.equal(actual.ssl.checkServerIdentity, undefined);
				assert.equal(captured.options[0].connectionTimeoutMillis, file.endsWith('.sh') ? undefined : file.includes('retirement') ? 5000 : 15000);
			}
			const local = await captureOperator(file, { [variable]: 'postgresql://test@127.0.0.1/fixture_test?sslmode=require' }, args);
			assert.equal(new Client(local.options[0]).connectionParameters.ssl, false, `${file}: intentional local transport preserved`);
			if (!file.includes('retirement') && !file.endsWith('.sh')) {
				const completed = await captureOperator(file, { [variable]: 'postgresql://test@localhost/fixture_test' }, args, true);
				assert.deepEqual(completed.errors, []);
				assert.equal(completed.queries[0], 'SET default_transaction_read_only = on');
				assert.equal(completed.ended, true, `${file}: successful read-only workflow closes its pool`);
			}
			const invalid = await captureOperator(file, { [variable]: target, MEGU_PG_CA_FILE: '' }, args);
			assert.equal(invalid.options.length, 0, `${file}: invalid trust cannot construct a connection`);
			assert.equal(invalid.errors.length, 1);
			assert.match(invalid.errors[0], file.endsWith('rehearsal') ? /Company rehearsal failed: validation/ : /MEGU_PG_CA_FILE/);
		}
		assert.equal(trusted.ssl.rejectUnauthorized, true);
		assert.equal(policy.postgresConnectionOptions(remote, {}).ssl.ca, undefined, 'Missing CA uses platform trust, never insecure TLS');
		for (const suffix of ['?sslmode=disable', '?ssl=no-verify', '?sslmode=no-verify', '?uselibpqcompat=true&sslmode=require', '?sslrootcert=missing&sslcert=missing&sslkey=missing']) {
			const config = policy.postgresConnectionOptions(remote + suffix, env);
			const actual = new Client(config).connectionParameters.ssl;
			assert.equal(actual.rejectUnauthorized, true, 'pg URL parsing cannot override certificate verification');
			assert.equal(actual.ca, trusted.ssl.ca); assert.equal(actual.checkServerIdentity, undefined, 'Native hostname validation preserved');
		}
		for (const host of ['localhost', '127.0.0.1', '[::1]', 'megu-db', 'host.docker.internal']) assert.equal(policy.postgresConnectionOptions(`postgresql://test@${host}/test`, {}).ssl, false);
		assert.equal(policy.postgresConnectionOptions('postgresql://test@localhost/test?host=db.example.test&sslmode=disable', {}).ssl.rejectUnauthorized, true, 'Effective host override cannot downgrade remote TLS');
		const duplicatedHost = policy.postgresConnectionOptions('postgresql://test@db.example.test/test?host=localhost&host=db.example.test', {});
		assert.equal(new Client(duplicatedHost).connectionParameters.host, 'db.example.test');
		assert.equal(new Client(duplicatedHost).connectionParameters.ssl.rejectUnauthorized, true, 'Last duplicate host follows pg semantics');
		assert.equal(policy.postgresConnectionOptions('postgresql://test@localhost.attacker.test/test', {}).ssl.rejectUnauthorized, true);
		for (const badPath of ['', path.join(dir, 'missing'), path.join(dir, 'server.key'), path.join(dir, 'server.pem')]) assert.throws(() => policy.postgresConnectionOptions(remote, { MEGU_PG_CA_FILE: badPath }), /MEGU_PG_CA_FILE/);
		fs.writeFileSync(path.join(dir, 'invalid.pem'), '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----');
		assert.throws(() => policy.postgresConnectionOptions(remote, { MEGU_PG_CA_FILE: path.join(dir, 'invalid.pem') }), /MEGU_PG_CA_FILE/);
		assert.throws(() => policy.postgresConnectionOptions('not-a-url'), /Invalid PostgreSQL connection URL/);
		const legacy = capturePool('../backend/database/database', { DATABASE_URL: remote + '?sslmode=disable', ...env });
		assert.equal(legacy.options[0].ssl.rejectUnauthorized, true);
		assert.equal(new Client(legacy.options[0]).connectionParameters.ssl.ca, trusted.ssl.ca);
		await assert.rejects(legacy.exports.initDatabase(), /Untrusted test certificate/, 'Remote failure never silently falls back to JSON');
		assert.equal(legacy.exports.isPostgres, true, 'Remote certificate failure does not select local JSON');
		const splitEnv = { ...env, DATABASE_URL: remote, MEGU_DATABASE_URL: 'postgresql://test@localhost/test' };
		const localCore = capturePool('../core/db', splitEnv); localCore.exports.getPool();
		assert.equal(localCore.options[0].ssl, false, 'Core retains the local override');
		assert.equal(capturePool('../backend/database/database', splitEnv).options[0].ssl.rejectUnauthorized, true, 'Legacy retains its separate remote URL');
		assert.equal(capturePool('../backend/database/database', { DATABASE_URL: splitEnv.MEGU_DATABASE_URL }).options[0].ssl, false);
		// Capture private factory calls through the public APIs, using a Pool
		// stub whose query throws only after recording its connection policy.
		for (const file of ['../core/db', '../adapters/health/health-log']) {
			const captured = capturePool(file, { DATABASE_URL: remote + '?sslmode=no-verify', ...env });
			if (file.endsWith('core/db')) captured.exports.getPool();
			else await captured.exports.record({ kind: 'boot' });
			assert.equal(captured.options.length, 1);
			assert.equal(new Client(captured.options[0]).connectionParameters.ssl.rejectUnauthorized, true);
			assert.equal(captured.options[0].ssl.ca, trusted.ssl.ca);
		}
		server = tls.createServer({ key: fs.readFileSync(path.join(dir, 'server.key')), cert: fs.readFileSync(path.join(dir, 'server.pem')) }, socket => socket.end());
		server.on('tlsClientError', () => {});
		await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
		const connect = (ssl, servername = 'db.example.test') => new Promise((resolve, reject) => {
			const socket = tls.connect({ ...ssl, host: '127.0.0.1', port: server.address().port, servername }, () => {
				const authorized = socket.authorized; socket.destroy(); resolve(authorized);
			});
			socket.on('error', reject);
		});
		assert.equal(await connect(trusted.ssl), true, 'Trusted CA and hostname accepted by native TLS');
		for (const [file, variable, args] of operators) {
			if (file.endsWith('rehearsal')) continue; // Effective remote targets are rejected above.
			const target = file.endsWith('rehearsal') || file.endsWith('.sh') ? 'postgresql://test@localhost/fixture_test?host=db.example.test&sslmode=disable' : remote + '?sslmode=disable';
			const captured = await captureOperator(file, { ...env, [variable]: target }, args);
			const ssl = new Client(captured.options[0]).connectionParameters.ssl;
			assert.equal(await connect(ssl), true, `${file}: trusted remote TLS works`);
			await assert.rejects(connect({ ...ssl, ca: undefined }), error => /SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(error.code), `${file}: untrusted certificate rejected`);
			await assert.rejects(connect(ssl, 'wrong.example.test'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }, `${file}: hostname verification enforced`);
		}
		await assert.rejects(connect(policy.postgresConnectionOptions(remote, {}).ssl), error => /SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(error.code), 'Untrusted certificate rejected');
		await assert.rejects(connect(trusted.ssl, 'wrong.example.test'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
		// Match pg's already-connected socket and absent SNI for IP hosts. A
		// localhost SAN must not authenticate a different remote database IP.
		const connectIP = ip => new Promise((resolve, reject) => {
			const plain = net.connect({ host: '127.0.0.1', port: server.address().port }, () => {
				const ssl = policy.postgresConnectionOptions(`postgresql://test@${ip}/test`, env).ssl;
				const socket = tls.connect({ socket: plain, ...ssl }, () => { const authorized = socket.authorized; socket.destroy(); resolve(authorized); });
				socket.on('error', reject);
			});
			plain.on('error', reject);
		});
		assert.equal(await connectIP('203.0.113.5'), true, 'Trusted matching IP SAN accepted');
		await assert.rejects(connectIP('203.0.113.6'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }, 'Remote IP cannot use a localhost certificate');
	}
	finally {
		if (server) await new Promise(resolve => server.close(resolve));
		fs.rmSync(dir, { recursive: true, force: true });
	}
	console.log('PostgreSQL TLS passed: native trust/hostname/IP handshakes, safe URL overrides, three application pools and five operator constructors, remote legacy fail-closed, CA validation and local compatibility.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
