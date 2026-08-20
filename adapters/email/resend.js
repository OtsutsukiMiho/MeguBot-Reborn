function escapeHtml(value) {
	return String(value || '').replace(/[&<>"']/g, char => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[char]));
}

async function send({ to, subject, body, ctaLabel, ctaUrl }) {
	const apiKey = process.env.RESEND_API_KEY;
	const from = process.env.MEGU_EMAIL_FROM;
	if (!apiKey || !from) throw new Error('Transactional email is not configured');
	const safeBody = escapeHtml(body).replace(/\n/g, '<br>');
	const safeCta = ctaUrl
		? `<p style="margin-top:24px"><a href="${escapeHtml(ctaUrl)}" style="background:#6d5dfc;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;display:inline-block;font-weight:700">${escapeHtml(ctaLabel)}</a></p>`
		: '';
	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			from,
			to: [to],
			subject,
			text: `${body}${ctaUrl ? `\n\n${ctaLabel}: ${ctaUrl}` : ''}`,
			html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937"><h1 style="font-size:22px">Megu</h1><p style="line-height:1.65">${safeBody}</p>${safeCta}<p style="color:#6b7280;font-size:12px;margin-top:32px">This is a transactional activity notification from Megu.</p></div>`,
		}),
	});
	if (!response.ok) throw new Error(`Resend returned ${response.status}`);
	return response.json();
}

module.exports = { send, escapeHtml };
