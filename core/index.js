// Megu core. Knows nothing about Discord, HTTP, LINE or React.
// Adapters depend on this file; this file depends on nothing above it.

const log = require('./log.js');
const db = require('./db.js');
const ids = require('./ids.js');
const money = require('./money.js');
const format = require('./format.js');
const promptpay = require('./promptpay.js');
const slip = require('./slip.js');
const receipt = require('./receipt.js');
const paymentEvidence = require('./payment-evidence.js');
const { initCoreSchema } = require('./schema.js');
const users = require('./users.js');
const accountMerge = require('./account-merge.js');
const oauthCredentials = require('./oauth-credentials.js');
const activities = require('./activities.js');
const reminders = require('./reminders.js');
const notifications = require('./notifications.js');
const access = require('./auth/access.js');
const tokens = require('./auth/tokens.js');
const voice = require('./megu/voice.js');

module.exports = {
	setLogger: log.setLogger,
	initCoreSchema,
	db,
	ids,
	money,
	format,
	promptpay,
	slip,
	receipt,
	paymentEvidence,
	users,
	accountMerge,
	oauthCredentials,
	activities,
	reminders,
	notifications,
	access,
	tokens,
	voice,
};
