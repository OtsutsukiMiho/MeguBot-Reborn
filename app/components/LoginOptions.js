'use client';

import { useCopy } from '../copy';

export default function LoginOptions({ compact = false, href = '/api/auth/login', label }) {
	const { t } = useCopy();
	return (
		<div className={`login-options ${compact ? 'login-options-compact' : ''}`}>
			<a href={href} className="btn btn-discord">
				<svg className="discord-provider-icon" viewBox="0 0 24 24" aria-hidden="true">
					<path fill="currentColor" d="M18.9 5.3A16 16 0 0 0 15 4.1l-.5 1a14 14 0 0 0-5 0l-.5-1a16 16 0 0 0-3.9 1.2C2.6 9 1.9 12.6 2.2 16.1A16 16 0 0 0 7 18.5l1.2-1.7c-.7-.3-1.3-.6-1.9-1l.5-.4c3.6 1.7 7.4 1.7 10.9 0l.6.4c-.6.4-1.3.7-1.9 1l1.1 1.7a16 16 0 0 0 4.8-2.4c.3-4.1-.7-7.6-3.4-10.8ZM8.7 14.2c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Zm6.7 0c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Z" />
				</svg>
				<span>{label || t.auth.discord}</span>
				<svg className="login-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
			</a>
		</div>
	);
}
