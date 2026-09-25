// A daily reminder missed while the bot was down goes out once, and the next
// one lands on the same time of day, in the future.
const assert = require('node:assert');
const { nextOccurrence, DAY_MS } = require('../core/reminder-schedule.js');

let n = 0;
function ok(name) {
	n++;
	console.log(`  ok  ${name}`);
}

const eight = Date.UTC(2026, 8, 20, 1, 0, 0);

assert.strictEqual(nextOccurrence(eight, eight), eight + DAY_MS);
ok('a reminder firing on time moves to tomorrow');

assert.strictEqual(nextOccurrence(eight, eight + 3 * DAY_MS + 60_000), eight + 4 * DAY_MS);
ok('three missed days fire once, and the next one is still at eight');

assert.strictEqual(nextOccurrence(eight, eight + 5_000), eight + DAY_MS);
ok('a tick a few seconds late does not skip a day');

assert.strictEqual(nextOccurrence(eight + DAY_MS, eight), eight + DAY_MS);
ok('a time already in the future is left alone');

assert.ok(nextOccurrence(Number.NaN, eight) > eight);
assert.ok(nextOccurrence(eight, eight, 0) > eight);
ok('bad input never answers a time in the past');

assert.throws(() => nextOccurrence(eight, Number.NaN), /reminder_clock_invalid/);
ok('a broken clock is an error, not a reminder every tick');

console.log(`\n${n} checks passed\n`);
