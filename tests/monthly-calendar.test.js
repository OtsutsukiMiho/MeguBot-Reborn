const assert = require('node:assert/strict');
// No live database is needed or permitted in calendar regression tests.
const dbPath = require.resolve('../core/db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
	query: () => { throw new Error('Unexpected database access'); },
	transaction: () => { throw new Error('Unexpected database access'); },
} };
const activities = require('../core/activities.js');
assert.equal(activities.periodKeyFor(new Date('2026-08-31T16:59:59Z')), '2026-08');
assert.equal(activities.periodKeyFor(new Date('2026-08-31T17:00:00Z')), '2026-09');
assert.equal(activities.periodKeyFor(new Date('2026-12-31T17:00:00Z')), '2027-01');
assert.equal(activities.currentPeriod({kind: 'recurring', periods: [{id:'aug', key:'2026-08'}, {id:'sep', key:'2026-09'}]}, new Date('2026-08-31T17:00:00Z')).id, 'sep');
console.log('Monthly calendar: Bangkok month/year boundaries and current period passed');
