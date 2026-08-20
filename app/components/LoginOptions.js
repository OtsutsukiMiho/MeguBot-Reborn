'use client';

import { useCopy } from '../copy';

export default function LoginOptions({ compact = false }) {
	const { t } = useCopy();
	return (
		<div className={`login-options ${compact ? 'login-options-compact' : ''}`}>
			<a href="/api/auth/google" className="btn btn-google"><span className="provider-letter" aria-hidden="true">G</span>{t.auth.google}</a>
			<a href="/api/auth/discord" className="btn btn-discord"><span className="provider-letter" aria-hidden="true">D</span>{t.auth.discord}</a>
		</div>
	);
}
