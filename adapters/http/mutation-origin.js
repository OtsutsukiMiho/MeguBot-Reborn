'use strict';

function httpUrl(value) {
	if (typeof value !== 'string' || !value || /\s/.test(value)) throw new Error('Invalid application origin.');
	let url;
	try { url = new URL(value); } catch { throw new Error('Invalid application origin.'); }
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Invalid application origin.');
	return url;
}

function createMutationOriginGuard(frontendUrl) {
	const trustedOrigin = httpUrl(frontendUrl).origin;
	return (req, res, next) => {
		if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !/^\/api(?:\/|$)/i.test(req.path)) return next();
		const consoleMutation = /^\/api\/(guilds|developer|account)(?:\/|$)/i.test(req.path)
			|| /^\/api\/auth\/logout(?:\/|$)/i.test(req.path);
		const activityMutation = /^\/api\/megu\/a\/[^/]+(?:\/|$)/i.test(req.path);
		const signedIn = req.session?.meguUserId || req.session?.user?.id || req.session?.discordUser?.id;
		if (!consoleMutation && !signedIn && !activityMutation) return next();
		try {
			const origin = req.headers.origin, referer = req.headers.referer;
			if (origin === undefined && referer === undefined) throw new Error('Missing origin evidence.');
			if (origin !== undefined) {
				const parsedOrigin = httpUrl(origin).origin;
				if (parsedOrigin !== trustedOrigin || origin !== parsedOrigin) throw new Error('Untrusted origin.');
			}
			if (referer !== undefined && httpUrl(referer).origin !== trustedOrigin) throw new Error('Untrusted referer.');
			if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) throw new Error('Conflicting origin evidence.');
			return next();
		}
		catch {
			return res.status(403).json({ error: 'Same-origin request required.', code: 'request_origin_invalid' });
		}
	};
}

module.exports = { createMutationOriginGuard };
