require('dotenv').config();
const assert = require('node:assert');
const core = require('../core/index.js');

// Where a person can be paid.
//
// Two things are being checked. The first is that a method belongs to its owner
// and to nobody else — these rows hold bank account numbers, and a route that
// takes an id without checking who is asking is how one group's organizer edits
// another's. The second is that the details already saved survived the move out
// of `users.promptpay_id`, because a migration that loses somebody's PromptPay
// number is indistinguishable from Megu forgetting it.

const { users, paymentMethods, activities, db } = core;
const created = { users: [] };
let n = 0;
function ok(msg) {
	n++;
	console.log(`  ok  ${msg}`);
}

async function main() {
	await core.initCoreSchema();

	const megu = await users.loginWithIdentity({
		provider: 'discord', providerUid: '__pm_megu__', username: 'megu', displayName: 'เม',
	});
	const nick = await users.loginWithIdentity({
		provider: 'discord', providerUid: '__pm_nick__', username: 'nick', displayName: 'นิค',
	});
	created.users.push(megu.user.id, nick.user.id);

	console.log('\nthe number people already saved');

	await users.setPromptPay(megu.user.id, { promptpayId: '0812345678', promptpayName: 'Megu M' });
	let mine = await paymentMethods.listForUser(megu.user.id);
	assert.strictEqual(mine.length, 1);
	assert.strictEqual(mine[0].type, 'promptpay');
	assert.strictEqual(mine[0].destination, '0812345678');
	assert.strictEqual(mine[0].accountName, 'Megu M');
	ok('setting a PromptPay number produces a payment method, not just a column');

	// Saving it again must correct the one that is there, not stack another on.
	await users.setPromptPay(megu.user.id, { promptpayId: '0898765432', promptpayName: 'Megu M' });
	mine = await paymentMethods.listForUser(megu.user.id);
	assert.strictEqual(mine.filter(m => m.type === 'promptpay').length, 1);
	assert.strictEqual(mine[0].destination, '0898765432');
	ok('changing it corrects the same method rather than adding a second');

	console.log('\nadding the rest');

	await paymentMethods.create(megu.user.id, {
		type: 'bank_transfer', label: 'กสิกร', destination: '123-4-56789-0', accountName: 'Teerapab B',
	});
	await paymentMethods.create(megu.user.id, {
		type: 'cash', label: 'เงินสด', instructions: 'เจอกันหน้าร้าน',
	});
	mine = await paymentMethods.listForUser(megu.user.id);
	assert.deepStrictEqual(mine.map(m => m.type), ['promptpay', 'bank_transfer', 'cash']);
	ok('a bank account and cash sit alongside the number, in the order they were added');

	// Cash has no account number, and switching a type must not leave one behind.
	assert.strictEqual(mine.find(m => m.type === 'cash').destination, null);
	assert.strictEqual(mine.find(m => m.type === 'cash').instructions, 'เจอกันหน้าร้าน');
	ok('cash keeps its instructions and carries no account details');

	console.log('\neach type is asked for what it needs, and only that');

	for (const [input, code] of [
		[{ type: 'bank_transfer', label: 'ธนาคาร' }, 'payment_method_destination_required'],
		[{ type: 'payment_link', label: 'จ่ายที่นี่' }, 'payment_method_url_required'],
		[{ type: 'payment_link', label: 'จ่ายที่นี่', url: 'javascript:alert(1)' }, 'payment_link_invalid'],
		[{ type: 'promptpay', label: 'PromptPay', destination: 'not a number' }, 'promptpay_unrecognised'],
		[{ type: 'sideways', label: 'x' }, 'payment_method_type_invalid'],
		[{ type: 'cash', label: '' }, 'payment_method_label_required'],
	]) {
		await assert.rejects(
			() => paymentMethods.create(megu.user.id, input),
			error => (error.code || error.message) === code,
			`${input.type} should fail with ${code}`,
		);
	}
	ok('a bank with no account, a link with no URL, a javascript: URL and an unreadable PromptPay are all refused');

	// Cash needs nothing but a name, which is the whole reason the forms differ.
	const petty = await paymentMethods.create(nick.user.id, { type: 'cash', label: 'Cash' });
	assert.strictEqual(petty.destination, null);
	ok('cash needs only a name');

	console.log('\nthey belong to their owner');

	await assert.rejects(
		() => paymentMethods.update(mine[1].id, nick.user.id, { type: 'bank_transfer', label: 'ของคนอื่น', destination: '9' }),
		error => error.code === 'payment_method_not_found',
	);
	ok('somebody else cannot edit a method by knowing its id');

	assert.strictEqual(await paymentMethods.remove(mine[1].id, nick.user.id), false);
	assert.strictEqual((await paymentMethods.listForUser(megu.user.id)).length, 3);
	ok('nor delete one — the row is still there afterwards');

	console.log('\norder is the default');

	const ids = (await paymentMethods.listForUser(megu.user.id)).map(m => m.id);
	const reordered = await paymentMethods.reorder(megu.user.id, [ids[1], ids[0]]);
	assert.deepStrictEqual(reordered.map(m => m.id), [ids[1], ids[0], ids[2]]);
	ok('naming two of three puts those first and leaves the rest behind them');

	const withStranger = await paymentMethods.reorder(megu.user.id, [petty.id, ids[0]]);
	assert.strictEqual(withStranger.length, 3);
	assert.strictEqual(withStranger[0].id, ids[0]);
	ok('an id belonging to somebody else is ignored, not adopted');

	console.log('\nwhat an activity offers');

	const act = await activities.createActivity({
		ownerUserId: megu.user.id,
		title: 'ทริป',
		participants: [
			{ displayName: 'เม', userId: megu.user.id },
			{ displayName: 'นิค', userId: nick.user.id },
		],
	});
	const full = await activities.getActivity(act.id);
	const P = Object.fromEntries(full.participants.map(p => [p.displayName, p.id]));

	assert.deepStrictEqual(
		full.paymentProfiles.get(P['เม']).methods.map(m => m.type).sort(),
		['bank_transfer', 'cash', 'promptpay'],
	);
	assert.deepStrictEqual(full.paymentProfiles.get(P['นิค']).methods.map(m => m.type), ['cash']);
	ok('every participant brings their own methods to the activity, not just the organizer');

	// The number the QR route asks for still resolves, from the method now.
	assert.strictEqual(full.paymentProfiles.get(P['เม']).promptpayId, '0898765432');
	assert.strictEqual(full.payee.promptpayId, '0898765432');
	ok('the PromptPay number still reaches the QR builder and the payee summary');

	console.log('\nclearing it');

	await users.setPromptPay(megu.user.id, { promptpayId: null });
	const left = await paymentMethods.listForUser(megu.user.id);
	assert.strictEqual(left.filter(m => m.type === 'promptpay').length, 0);
	assert.strictEqual(left.length, 2);
	ok('clearing the number removes that method and leaves the bank account alone');
}

async function cleanup() {
	await db.query('DELETE FROM activities WHERE owner_user_id = ANY($1::text[])', [created.users]).catch(() => undefined);
	for (const id of created.users) {
		await db.query('DELETE FROM users WHERE id = $1', [id]).catch(() => undefined);
	}
}

main()
	.then(cleanup)
	.then(() => db.close())
	.then(() => console.log(`\n${n} checks passed\n`))
	.catch(async (err) => {
		console.error('\nFAILED:', err.message, '\n', err.stack);
		await cleanup().catch(() => undefined);
		await db.close().catch(() => undefined);
		process.exitCode = 1;
	});
