import ActivityShell from '../../components/activity/ActivityShell';
import { billPreview } from '../../../core/bill-preview.js';
import { expressOrigin } from '../../lib/express-origin.js';

/**
 * The preview Discord and LINE draw under a pasted bill link.
 *
 * Read from the API with no cookie on purpose: the preview is public to anyone
 * holding the link, so it must be built from exactly what a signed-out reader
 * is allowed to see. A slow or failed read falls back to generic bills wording
 * rather than holding up the page.
 */
export async function generateMetadata({ params }) {
	const { code } = await params;
	let activity = null;
	try {
		const res = await fetch(`${expressOrigin()}/api/megu/a/${encodeURIComponent(code)}`, {
			cache: 'no-store',
			signal: AbortSignal.timeout(3000),
		});
		if (res.ok) activity = (await res.json()).activity || null;
	}
	catch {
		activity = null;
	}
	// The bill's server decides, so the preview and the card in that server
	// speak the same language. A bill made on the web has none and stays Thai.
	const { title, description } = billPreview(activity, activity?.serverLang || 'th');
	return {
		title,
		description,
		openGraph: { title, description, siteName: 'Megu', type: 'website' },
	};
}

/**
 * Everything under /a/{code} shares one activity, one request path and one
 * reason dialog. Holding them here is what lets each screen below be only the
 * part that differs.
 */
export default async function ActivityLayout({ children, params }) {
	const { code } = await params;
	return <ActivityShell code={code}>{children}</ActivityShell>;
}
