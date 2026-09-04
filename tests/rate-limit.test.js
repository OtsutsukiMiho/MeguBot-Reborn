// The block guard is the one thing standing between an ordinary bad afternoon
// and a whole deploy being refused by Cloudflare for an hour, and until now it
// had no tests at all. Everything here is pure logic — no network, no Discord.
//
// The rules it enforces are in DISCORD-RATE-LIMITS.md. What matters:
//
//   - it recognises both the legacy `code: 0` body and Discord's current 40333;
//   - it recognises it wherever it is hiding — a string, an Error, a discord.js
//     rejection carrying rawError;
//   - once tripped, `blocked()` stays true for the whole cooldown, because the
//     ban lengthens under traffic and retrying is the thing that does it;
//   - a block found by one process can be adopted by another without that
//     process having to make a failing request of its own to discover it.
require('dotenv').config();
const assert = require('node:assert');
const {
	isGlobalBlock,
	isSevereRateLimit,
	createBlockGuard,
	guardRestClient,
	recordInvalidRequestWarning,
	createInvalidRequestDiagnostics,
	BLOCK_COOLDOWN_MS,
	BLOCK_EXIT_CODE,
	INVALID_REQUEST_STOP_THRESHOLD,
	LOCAL_BLOCK_ERROR_CODE,
	BLOCK_TRIP_ERROR,
	RATE_LIMIT_WAIT_CEILING_MS,
} = require('../adapters/discord/rate-limit.js');

let n = 0;
function ok(msg) {
	n++;
	console.log(`  ok  ${msg}`);
}

const CLOUDFLARE_BODY = '{"code":0,"message":"You are being blocked from accessing our API temporarily due to exceeding global rate limits."}';

function main() {
	// 1. The body that took the deploy down, in each shape it reaches us in.
	{
		assert.ok(isGlobalBlock(CLOUDFLARE_BODY), 'the raw response body');
		assert.ok(isGlobalBlock(new Error(`Discord token exchange failed: ${CLOUDFLARE_BODY}`)),
			'wrapped in an Error by the OAuth adapter');
		assert.ok(isGlobalBlock({ rawError: { code: 0, message: 'You are being blocked from accessing our API temporarily.' } }),
			'a discord.js rejection carrying rawError');
		assert.ok(isGlobalBlock({ code: 40333, message: 'Cloudflare is blocking your request.' }),
			'Discord\'s current documented Cloudflare error code');
		assert.ok(isGlobalBlock({ rawError: { code: 40333, message: 'Request blocked' } }),
			'the current code nested in a discord.js rejection');
		ok('legacy and current Cloudflare block responses are recognised');
	}

	// 2. An ordinary 429 is not this. Treating one as a block would take the bot
	//    off Discord for fifteen minutes over a busy route.
	{
		assert.ok(!isGlobalBlock('{"message":"The resource is rate limited.","retry_after":0.53,"global":false}'),
			'a per-route 429 is not a block');
		assert.ok(!isGlobalBlock(new Error('Unknown Message')), 'an ordinary API error is not a block');
		assert.ok(!isGlobalBlock(null) && !isGlobalBlock(undefined) && !isGlobalBlock(''),
			'nothing at all is not a block');
		ok('ordinary rate limits and errors do not trip it');
	}

	// 2b. isSevereRateLimit decides what @discordjs/rest does when it is limited:
	//     sleep and send again, or fail and let the caller find out. Its retry
	//     path for an unexpected 429 does not increment the retry counter, so
	//     "sleep and send again" has no cap — which is why the zero-wait case
	//     below matters more than it looks.
	{
		assert.strictEqual(isSevereRateLimit({ global: false, scope: 'user', timeToReset: 250 }), false,
			'a short per-route wait is ordinary and worth sleeping through');
		assert.strictEqual(isSevereRateLimit({ global: false, scope: 'user', timeToReset: RATE_LIMIT_WAIT_CEILING_MS }), false,
			'right up to the ceiling');
		ok('a short, known per-route wait is left to discord.js to sleep through');

		assert.strictEqual(isSevereRateLimit({ global: true, scope: 'user', timeToReset: 100 }), true,
			'a global limit fails even when the wait is short');
		assert.strictEqual(isSevereRateLimit({ global: false, scope: 'global', timeToReset: 100 }), true,
			'and so does a global scope');
		assert.strictEqual(isSevereRateLimit({ global: false, scope: 'user', timeToReset: RATE_LIMIT_WAIT_CEILING_MS + 1 }), true,
			'a long wait is no longer traffic management');
		ok('global limits and long waits fail the call instead of queueing it');

		// The Cloudflare block answers 429 without Discord's rate-limit headers,
		// so the wait computes to zero — and a zero-length sleep inside an
		// uncapped retry loop is a busy loop against a banned IP.
		assert.strictEqual(isSevereRateLimit({ global: false, scope: 'user', timeToReset: 0 }), true,
			'a 429 with no wait attached must fail');
		assert.strictEqual(isSevereRateLimit({ global: false, scope: 'user', timeToReset: undefined }), true,
			'so must one with no wait field at all');
		assert.strictEqual(isSevereRateLimit({ global: false, scope: 'user', timeToReset: -5 }), true,
			'and one with a nonsensical wait');
		assert.strictEqual(isSevereRateLimit(null), true, 'when in doubt, fail the call');
		ok('a 429 carrying no usable wait fails — that is the shape of the block');
	}

	// 3. record() only fires onTrip once. The announcement is "we have just been
	//    blocked", not "we are still blocked", and a repeat during a live block
	//    would be one log line per refused request.
	{
		let trips = 0;
		const guard = createBlockGuard({ onTrip: () => { trips += 1; } });

		assert.strictEqual(guard.blocked(), false, 'a fresh guard is not blocked');
		assert.strictEqual(guard.record('Unknown Message'), false, 'an unrelated failure is ignored');
		assert.strictEqual(trips, 0, 'and does not announce anything');

		assert.strictEqual(guard.record(CLOUDFLARE_BODY), true, 'the block is recorded');
		assert.strictEqual(guard.blocked(), true, 'and we are now blocked');
		assert.strictEqual(trips, 1, 'announced once');

		const firstDeadline = guard.blockedUntil();
		assert.strictEqual(guard.record(CLOUDFLARE_BODY), false, 'a duplicate refusal is not a new trip');
		assert.strictEqual(guard.record(CLOUDFLARE_BODY), false, 'nor is the next duplicate');
		assert.strictEqual(trips, 1, 'and not again while the same block is live');
		assert.strictEqual(guard.blockedUntil(), firstDeadline, 'duplicate refusals do not renew our own cooldown');
		ok('a live block announces itself once, not once per refused request');
	}

	// 4. The cooldown is a real deadline, not a flag. Fifteen minutes is chosen
	//    to outlast a typical Cloudflare block without guessing at it.
	{
		const guard = createBlockGuard();
		const before = Date.now();
		guard.record(CLOUDFLARE_BODY);

		const remaining = guard.retryAfterSeconds();
		assert.ok(remaining > 0, 'there is time left on it');
		assert.ok(remaining <= Math.ceil(BLOCK_COOLDOWN_MS / 1000), 'and no more than the cooldown');
		assert.ok(guard.blockedUntil() >= before + BLOCK_COOLDOWN_MS - 1000,
			'the deadline is roughly a cooldown away');
		assert.ok(BLOCK_COOLDOWN_MS >= 60 * 60 * 1000,
			'the cooldown must not resume at the old 15-minute deadline inside an hour-long block');
		ok(`the cooldown runs for ${Math.round(BLOCK_COOLDOWN_MS / 60000)} minutes and can be handed to another process`);
	}

	// 5. adopt() is how the other processes on this box find out. The ban is on
	//    the IP, so it applies to all of them, but each holds its own guard and
	//    would otherwise only learn by sending the request we are trying to
	//    avoid. Adopting is silent: the process that saw the refusal owns the
	//    log line.
	{
		let trips = 0;
		const guard = createBlockGuard({ onTrip: () => { trips += 1; } });
		const deadline = Date.now() + BLOCK_COOLDOWN_MS;

		assert.strictEqual(guard.adopt(deadline), true, 'a new deadline is adopted');
		assert.strictEqual(guard.blocked(), true, 'and blocks immediately');
		assert.strictEqual(trips, 0, 'without announcing a block it did not discover');

		assert.strictEqual(guard.adopt(deadline - 60_000), false, 'an earlier deadline is ignored');
		assert.ok(guard.blockedUntil() === deadline, 'and does not shorten the block');
		assert.strictEqual(guard.adopt('nonsense'), false, 'so is a value that is not a timestamp');
		ok('a block found by one process transfers to another, and never shortens');
	}

	// 6. trip() without a response to read. Three global 429s in a minute means
	//    the ban is coming; stopping first is cheaper than being stopped.
	{
		let trips = 0;
		const guard = createBlockGuard({ onTrip: () => { trips += 1; } });
		guard.trip();
		assert.strictEqual(guard.blocked(), true, 'the early warning blocks too');
		assert.strictEqual(trips, 1, 'and announces, because we are the ones who noticed');
		ok('the guard can be tripped by a pattern, not only by a refusal');
	}

	// 7. A short cooldown, so the expiry can be observed rather than assumed.
	{
		const guard = createBlockGuard({ cooldownMs: 20 });
		guard.record(CLOUDFLARE_BODY);
		assert.strictEqual(guard.blocked(), true, 'blocked while the cooldown runs');

		const waitedOut = new Promise(resolve => setTimeout(resolve, 40));
		return waitedOut.then(async () => {
			assert.strictEqual(guard.blocked(), false, 'and clear once it expires');
			assert.strictEqual(guard.retryAfterSeconds(), 0, 'with nothing left to wait for');
			ok('the block expires on its own — it is a deadline, not a latch');

			guard.record(CLOUDFLARE_BODY);
			guard.clear();
			assert.strictEqual(guard.blocked(), false, 'clear() releases it for tests and manual overrides');
			ok('clear() releases a live block');

			// 8. EX_TEMPFAIL. index.js reads this to mean "held down deliberately".
			assert.strictEqual(BLOCK_EXIT_CODE, 75, 'the block exit code is EX_TEMPFAIL');
			ok('the supervisor still has an exit code that means "do not restart me yet"');

			await restCircuitBreakerStopsEveryCall();
			invalidRequestWarningsStopBeforeCloudflare();
			invalidRequestDiagnosticsNameTheRoute();

			everyRestClientRefusesToRetryForever();
		});
	}
}

async function restCircuitBreakerStopsEveryCall() {
	let requests = 0;
	const rest = {
		async request(options) {
			requests++;
			if (options?.fail) throw options.fail;
			return options?.answer;
		},
	};
	const guard = createBlockGuard({ cooldownMs: 1000 });
	guardRestClient(rest, guard);

	assert.strictEqual(await rest.request({ answer: 'ok' }), 'ok', 'ordinary calls still reach Discord');
	assert.strictEqual(requests, 1);

	let refusal;
	await assert.rejects(
		rest.request({ fail: new Error(CLOUDFLARE_BODY) }),
		error => {
			refusal = error;
			return /blocked from accessing our API/i.test(error.message);
		},
		'the refusal is preserved for the caller',
	);
	assert.strictEqual(refusal[BLOCK_TRIP_ERROR], true, 'the first refusal is marked for the feature-level diagnostic');
	assert.strictEqual(guard.blocked(), true, 'a swallowed feature error cannot hide the block from the REST guard');

	await assert.rejects(
		rest.request({ answer: 'must not leave the process' }),
		error => error.code === LOCAL_BLOCK_ERROR_CODE,
		'a locally skipped call has a stable error code',
	);
	assert.strictEqual(requests, 2, 'no request reaches the underlying REST client after the first block');
	ok('one REST circuit breaker covers direct manager calls and swallowed failures');
}

function invalidRequestWarningsStopBeforeCloudflare() {
	const guard = createBlockGuard({ cooldownMs: 1000 });
	assert.strictEqual(
		recordInvalidRequestWarning({ count: INVALID_REQUEST_STOP_THRESHOLD - 1 }, guard),
		false,
		'a warning below the local ceiling only reports',
	);
	assert.strictEqual(guard.blocked(), false);
	assert.strictEqual(
		recordInvalidRequestWarning({ count: INVALID_REQUEST_STOP_THRESHOLD }, guard),
		true,
		'the local ceiling opens the circuit',
	);
	assert.strictEqual(guard.blocked(), true);
	ok(`invalid 401/403/429 traffic stops at ${INVALID_REQUEST_STOP_THRESHOLD}, before Discord's hard limit`);
}

function invalidRequestDiagnosticsNameTheRoute() {
	const diagnostics = createInvalidRequestDiagnostics({ windowMs: 1000 });
	diagnostics.record({ method: 'GET', route: '/guilds/:id/members' }, { status: 403 }, 100);
	diagnostics.record({ method: 'GET', route: '/guilds/:id/members' }, { status: 403 }, 101);
	diagnostics.record({ method: 'POST', route: '/channels/:id/messages' }, { status: 429 }, 102);
	diagnostics.record({ method: 'GET', route: '/ignored' }, { status: 404 }, 103);
	assert.strictEqual(
		diagnostics.summary(),
		'403 GET /guilds/:id/members ×2, 429 POST /channels/:id/messages ×1',
		'aggregate warnings retain the status, method and normalized route',
	);
	ok('invalid-request warnings name the routes that caused them');
}

/**
 * The checklist item, as a test.
 *
 * "Any new `Client` or `REST` sets `rejectOnRateLimit`. The default retries an
 * unexpected 429 forever." — DISCORD-RATE-LIMITS.md
 *
 * That item was checked by reading, and reading once missed one:
 * `deploy-commands.js` constructed a bare `new REST()`. The uncapped retry path
 * never settles its promise, so the script's own `catch` could not report it.
 *
 * Scanning the source is crude, and it is the only check that fires on a file
 * nobody thought to test. A construction site that is genuinely fine can name
 * the option and pass.
 */
/** The text of a call, from its opening paren to the one that closes it. */
function balancedCall(source, openIndex) {
	let depth = 0;
	for (let i = openIndex; i < source.length; i++) {
		if (source[i] === '(') {
			depth++;
		}
		else if (source[i] === ')') {
			depth--;
			if (depth === 0) return source.slice(openIndex, i + 1);
		}
	}
	return source.slice(openIndex);
}

function everyRestClientRefusesToRetryForever() {
	const fs = require('node:fs');
	const path = require('node:path');
	const root = path.join(__dirname, '..');

	const files = [];
	(function walk(dir) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith('.js')) files.push(full);
		}
	})(root);

	const offenders = [];
	for (const file of files) {
		const source = fs.readFileSync(file, 'utf8');
		for (const match of source.matchAll(/new (?:REST|Client)\s*\(/g)) {
			// discord.js only. `pg`'s Client shares the name and has nothing to
			// do with any of this.
			if (!/require\(['"](discord\.js|@discordjs\/rest)['"]\)/.test(source)) continue;
			// Read to the matching close paren rather than a fixed window: the
			// bot's Client carries a long comment between the brace and the
			// `rest` block, and any window short enough to be safe elsewhere
			// would cut it off and report a false offender.
			const call = balancedCall(source, match.index + match[0].length - 1);
			if (!call.includes('rejectOnRateLimit')) {
				offenders.push(`${path.relative(root, file)}: ${call.split('\n')[0].trim()}`);
			}
		}
	}

	assert.deepStrictEqual(offenders, [],
		`these construct a discord.js REST/Client without rejectOnRateLimit, which retries an unexpected 429 forever:\n  ${offenders.join('\n  ')}`);
	ok(`every discord.js REST/Client sets rejectOnRateLimit (${files.length} files scanned)`);
}

Promise.resolve()
	.then(main)
	.then(() => console.log(`\n  ${n} checks passed`))
	.catch((error) => {
		console.error(`\n  FAILED  ${error.message}`);
		process.exitCode = 1;
	});
