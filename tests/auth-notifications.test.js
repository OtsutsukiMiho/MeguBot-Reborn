const assert = require('node:assert');
const crypto = require('node:crypto');
const vault = require('../core/auth/credential-vault.js');
const notifications = require('../core/notifications.js');
const googleOAuth = require('../adapters/google/oauth.js');
const { escapeHtml } = require('../adapters/email/resend.js');
const reminders = require('../core/reminders.js');

const key = crypto.randomBytes(32).toString('base64');
const secret = { accessToken: 'access-secret', refreshToken: 'refresh-secret' };
const sealed = vault.seal(secret, key);
assert.deepStrictEqual(vault.open(sealed, key), secret, 'OAuth credentials should round-trip through AES-GCM');
assert.strictEqual(vault.seal(secret, null), null, 'missing encryption key must never produce a plaintext envelope');
assert.throws(() => vault.open({ ...sealed, ciphertext: Buffer.from('tampered').toString('base64') }, key));

assert.deepStrictEqual(notifications.channelsFor('both', { hasDiscord: true, hasEmail: true }), ['discord', 'email']);
assert.deepStrictEqual(notifications.channelsFor('both', { hasDiscord: true, hasEmail: false }), ['discord']);
assert.deepStrictEqual(notifications.channelsFor('email', { hasDiscord: true, hasEmail: false }), []);
assert.deepStrictEqual(notifications.channelsFor('off', { hasDiscord: true, hasEmail: true }), []);

const rendered = notifications.render({ payload: {
	locale: 'th', subjectEn: 'English', subjectTh: 'ไทย', bodyEn: 'Paid', bodyTh: 'จ่ายแล้ว',
	ctaUrl: 'https://megu.test/a/ABC',
} });
assert.strictEqual(rendered.subject, 'ไทย');
assert.strictEqual(rendered.body, 'จ่ายแล้ว');
assert.strictEqual(rendered.ctaLabel, 'เปิดใน Megu');

assert.deepStrictEqual(googleOAuth.toIdentityProfile({
	sub: 'google-subject', email: 'megu@example.com', email_verified: true,
	name: 'めぐ', picture: 'https://example.com/avatar.png',
}), {
	provider: 'google', providerUid: 'google-subject', email: 'megu@example.com', emailVerified: true,
	username: 'megu@example.com', displayName: 'めぐ', avatarUrl: 'https://example.com/avatar.png',
});

assert.strictEqual(escapeHtml('<script>"Megu" & friends</script>'), '&lt;script&gt;&quot;Megu&quot; &amp; friends&lt;/script&gt;');

const englishReminder = reminders.composeStatement({
	displayName: 'めぐ', currency: 'JPY', total: 120000,
	lines: [{ title: 'Dinner', amountSatang: 120000, currency: 'JPY', code: 'ABC' }],
	locale: 'en', baseUrl: 'https://megu.test',
});
assert.match(englishReminder, /one outstanding payment/);
assert.match(englishReminder, /¥1,200/);

console.log('auth + notification tests passed');
