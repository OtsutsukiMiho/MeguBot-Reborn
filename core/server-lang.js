// Which language Megu speaks, decided once for each kind of reader.
//
// A bill card sits in a channel where the whole group reads it, so it follows
// the server, never the person who happened to press the button. Before this,
// a Thai server got an English card whenever someone with an English Discord
// client clicked, and the link preview stayed Thai, so one bill spoke two
// languages at once.
//
// A private reply is the opposite: it is read by one person, so it follows
// what that person chose on their account, and only when they never chose
// does it fall back to their Discord client.
//
// Both are plain functions over values the adapters have already read, so the
// rule is tested here and the adapters only fetch.

const { isSupported, resolveLang } = require('./locales.js');

// The guild_variables key, next to tts_channel_id and the rest.
const SERVER_LANG_KEY = 'megu_lang';

// When nothing is known about a server at all: no stored choice and no Discord
// locale to read, as in the web process with the bot unreachable. Megu's
// servers are Thai first, and every bill formatter already defaults to Thai.
const SERVER_FALLBACK = 'th';

/**
 * @param {object} input
 * @param {string|null} [input.stored]           guild_variables.megu_lang
 * @param {string|null} [input.preferredLocale]  guild.preferredLocale from Discord
 * @returns {string} a code Megu speaks
 */
function serverLang({ stored = null, preferredLocale = null } = {}) {
	if (storedServerLang(stored)) return storedServerLang(stored);
	if (preferredLocale) return resolveLang(preferredLocale);
	return SERVER_FALLBACK;
}

/**
 * @param {object} input
 * @param {{ locale: string, localeSet: boolean }|null} [input.preference]  the account's, when it has one
 * @param {string|null} [input.clientLocale]  interaction.locale, the Discord client
 * @returns {string}
 */
function personalLang({ preference = null, clientLocale = null } = {}) {
	if (preference?.localeSet && isSupported(preference.locale)) return preference.locale;
	return resolveLang(clientLocale);
}

/** What guild_variables holds, if it is a language Megu speaks; null otherwise. */
function storedServerLang(value) {
	return isSupported(value) ? String(value).trim().toLowerCase() : null;
}

/** Cleans a value from the dashboard or the slash command: a code, or null for "follow Discord". */
function normalizeServerLang(value) {
	if (value === null || value === undefined || value === '' || value === 'auto') return null;
	const code = String(value).trim().toLowerCase();
	if (!isSupported(code)) throw new Error('server_lang_invalid');
	return code;
}

module.exports = { SERVER_LANG_KEY, SERVER_FALLBACK, serverLang, personalLang, storedServerLang, normalizeServerLang };
