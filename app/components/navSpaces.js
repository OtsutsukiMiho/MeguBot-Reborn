// Which side of Megu a page belongs to, so the navbar shows only that side's
// menu: bills for friends, or work for organisations.
//
// Server pages belong to both. Someone splitting bills still invites the bot
// from there, and so does an organisation, so a server page keeps the menu of
// whichever side the reader came from. Pages that belong to neither (the front
// door, the account page) show the switcher and nothing else.

const BILLS = ['/bills', '/activities', '/a/'];
const ORG = ['/org', '/projects', '/p/', '/teams', '/companies'];
const SHARED = ['/servers'];

const STORAGE_KEY = 'megu-space';

function matches(pathname, prefixes) {
	return prefixes.some(prefix => (prefix.endsWith('/')
		? pathname.startsWith(prefix)
		: pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

/** 'bills', 'org', or null for a page that belongs to neither. */
function spaceFor(pathname, remembered) {
	if (matches(pathname, BILLS)) return 'bills';
	if (matches(pathname, ORG)) return 'org';
	if (matches(pathname, SHARED)) return remembered === 'bills' ? 'bills' : 'org';
	return null;
}

/** True when the page decides the side by itself, so it is worth remembering. */
function ownsSpace(pathname) {
	return matches(pathname, BILLS) || matches(pathname, ORG);
}

function readRemembered() {
	try { return window.localStorage.getItem(STORAGE_KEY); }
	catch { return null; }
}

function remember(space) {
	try { window.localStorage.setItem(STORAGE_KEY, space); }
	catch { /* private windows may refuse storage; the menu still works */ }
}

module.exports = { spaceFor, ownsSpace, readRemembered, remember };
