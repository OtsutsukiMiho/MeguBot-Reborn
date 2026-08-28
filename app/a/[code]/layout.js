'use client';

import { use } from 'react';
import ActivityShell from '../../components/activity/ActivityShell';

/**
 * Everything under /a/{code} shares one activity, one request path and one
 * reason dialog. Holding them here is what lets each screen below be only the
 * part that differs.
 */
export default function ActivityLayout({ children, params }) {
	const { code } = use(params);
	return <ActivityShell code={code}>{children}</ActivityShell>;
}
