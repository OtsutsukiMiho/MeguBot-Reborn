'use strict';

async function requestServerAction(fetchImpl, url, options, messages = {}) {
	try {
		const response = await fetchImpl(url, options);
		const data = await response.json().catch(() => ({}));
		if (!response.ok || !data.success) {
			return { ok: false, error: data.error || messages.failure || 'Request failed.', ambiguous: false, data };
		}
		return { ok: true, data, ambiguous: false };
	} catch (error) {
		const ambiguous = error?.name === 'TypeError' && Boolean(messages.deliveryUnknown);
		return { ok: false, error: ambiguous ? messages.deliveryUnknown : (error?.message || messages.failure || 'Request failed.'), ambiguous };
	}
}

module.exports = { requestServerAction };
