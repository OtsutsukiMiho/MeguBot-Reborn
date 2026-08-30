function escapeHtml(value) {
	return String(value || '').replace(/[&<>"']/g, char => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[char]));
}

function button(label, url, { quiet = false } = {}) {
	const skin = quiet
		? 'background:#fff;color:#4b5563;border:1px solid #d1d5db;font-weight:600'
		: 'background:#6d5dfc;color:#fff;border:1px solid #6d5dfc;font-weight:700';
	return `<a href="${escapeHtml(url)}" style="${skin};text-decoration:none;padding:12px 18px;border-radius:10px;display:inline-block;margin-right:8px">${escapeHtml(label)}</a>`;
}

async function send({ to, subject, body, ctaLabel, ctaUrl, secondaryLabel, secondaryUrl }) {
	const apiKey = process.env.RESEND_API_KEY;
	const from = process.env.MEGU_EMAIL_FROM;
	if (!apiKey || !from) throw new Error('Transactional email is not configured');
	const safeBody = escapeHtml(body).replace(/\n/g, '<br>');
	// The quiet one is second and looks second. It is an escape hatch for the
	// reader who cannot pay today, not a choice competing with paying.
	const buttons = [
		ctaUrl ? button(ctaLabel, ctaUrl) : '',
		secondaryUrl ? button(secondaryLabel, secondaryUrl, { quiet: true }) : '',
	].filter(Boolean).join('');
	const safeCta = buttons ? `<p style="margin-top:24px">${buttons}</p>` : '';
	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			from,
			to: [to],
			subject,
			text: `${body}${ctaUrl ? `\n\n${ctaLabel}: ${ctaUrl}` : ''}${secondaryUrl ? `\n${secondaryLabel}: ${secondaryUrl}` : ''}`,
			html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937"><h1 style="font-size:22px">Megu</h1><p style="line-height:1.65">${safeBody}</p>${safeCta}<p style="color:#6b7280;font-size:12px;margin-top:32px">This is a transactional activity notification from Megu.</p></div>`,
		}),
	});
	if (!response.ok) throw new Error(`Resend returned ${response.status}`);
	return response.json();
}

module.exports = { send, escapeHtml };
