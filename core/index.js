// Megu core. Knows nothing about Discord, HTTP, LINE or React.
// Adapters depend on this file; this file depends on nothing above it.

const log = require('./log.js');
const db = require('./db.js');
const ids = require('./ids.js');
const money = require('./money.js');
const { initCoreSchema } = require('./schema.js');
const users = require('./users.js');
const activities = require('./activities.js');
const reminders = require('./reminders.js');
const access = require('./auth/access.js');
const tokens = require('./auth/tokens.js');
const voice = require('./megu/voice.js');

module.exports = {
	setLogger: log.setLogger,
	initCoreSchema,
	db,
	ids,
	money,
	users,
	activities,
	reminders,
	access,
	tokens,
	voice,
};
