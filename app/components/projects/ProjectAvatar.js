'use client';

import { useState } from 'react';

export default function ProjectAvatar({ name, avatarUrl, className }) {
	const [failedUrl, setFailedUrl] = useState(null);
	const initials = String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
	return <span className={className} aria-hidden="true">
		{avatarUrl && failedUrl !== avatarUrl
			? <img src={avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(avatarUrl)} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
			: initials}
	</span>;
}
