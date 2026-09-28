'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_POOL_MAX, poolMax } = require('../core/pool-config.js');

let checks = 0;
function ok(message) {
	checks++;
	console.log(`  ok  ${message}`);
}

assert.equal(DEFAULT_POOL_MAX, 1);
assert.equal(poolMax(undefined), 1);
assert.equal(poolMax(''), 1);
assert.equal(poolMax('0'), 1);
assert.equal(poolMax('-2'), 1);
assert.equal(poolMax('1.5'), 1);
assert.equal(poolMax('nope'), 1);
ok('missing and invalid pool limits fall back to the conservative default');

assert.equal(poolMax('1'), 1);
assert.equal(poolMax('2'), 2);
assert.equal(poolMax(3), 3);
ok('positive integer pool limits are accepted explicitly');

const root = path.join(__dirname, '..');
const legacy = fs.readFileSync(path.join(root, 'backend', 'database', 'database.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'core', 'db.js'), 'utf8');
assert.match(legacy, /max:\s*poolMax\(\)/);
assert.match(core, /max:\s*poolMax\(\)/);
assert.match(legacy, /async function close\(\)/);
assert.match(core, /close\(\{ permanent = false \} = \{\}\)/);
ok('both primary pools share the validated limit and expose cleanup');

console.log(`\n${checks} checks passed\n`);
