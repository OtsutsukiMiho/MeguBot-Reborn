'use client';

import { useState } from 'react';
import { useCopy } from '../copy';

/**
 * The owner's half of the pay screen: where the money lands, and who it lands
 * with.
 *
 * The number belongs to the person, not to the activity — it is saved on their
 * account and every activity they organise picks it up — but it is edited here,
 * because here is where they find out it is missing. A settings page they have
 * to go looking for is a settings page nobody visits.
 */
export default function PromptPaySetup({ payTo, participants, busy, call, onSaved }) {
	const { t, error } = useCopy();

	const [open, setOpen] = useState(!payTo?.ready);
	const [number, setNumber] = useState(payTo?.number || '');
	const [name, setName] = useState(payTo?.accountName || '');
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState('');
	const [saved, setSaved] = useState(false);

	async function save(event) {
		event.preventDefault();
		setSaving(true);
		setProblem('');
		try {
			const res = await fetch('/api/megu/me', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ promptpayId: number, promptpayName: name }),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				setProblem(error(data));
				return;
			}
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
			// The QR, the masked number and the account name all come down with
			// the activity, so the page has to hear about this from the server
			// rather than patch itself and hope the two agree.
			onSaved?.();
		}
		catch {
			setProblem(error({ code: 'offline' }));
		}
		finally {
			setSaving(false);
		}
	}

	return (
		<div className="pp-setup">
			<div className="pp-head">
				<span className="field-label" style={{ margin: 0 }}>{t.promptpay.title}</span>
				<button type="button" className="link-btn" onClick={() => setOpen(v => !v)}>
					{open ? t.common.done : t.common.edit}
				</button>
			</div>

			{!open && (
				<p className="pp-summary">
					{payTo?.ready
						? <>{t.promptpay.payee} <strong>{payTo.displayName}</strong> · <span className="pay-number">{payTo.masked}</span></>
						: <span className="pp-missing">{t.promptpay.notSet}</span>}
				</p>
			)}

			{open && (
				<form onSubmit={save} className="pp-form">
					{problem && <div className="error-note">{problem}</div>}

					<div>
						<label className="field-label" htmlFor="pp-number">{t.promptpay.field}</label>
						<input
							id="pp-number"
							className="form-control"
							inputMode="tel"
							autoComplete="tel"
							placeholder="081-234-5678"
							value={number}
							onChange={e => setNumber(e.target.value)}
						/>
					</div>

					<div>
						<label className="field-label" htmlFor="pp-name">{t.promptpay.nameField}</label>
						<input
							id="pp-name"
							className="form-control"
							placeholder={payTo?.displayName || ''}
							value={name}
							onChange={e => setName(e.target.value)}
						/>
						<small className="pp-note">{t.promptpay.nameHint}</small>
					</div>

					{/* Whoever fronted the money is the one owed it, and that is
					    not always the person who opened the activity. */}
					{participants.length > 1 && (
						<div>
							<label className="field-label" htmlFor="pp-payee">{t.promptpay.payeeField}</label>
							<select
								id="pp-payee"
								className="form-control"
								value={payTo?.participantId || ''}
								disabled={busy}
								onChange={e => call('POST', '/payee', { participantId: e.target.value || null })}
							>
								{participants.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
							</select>
						</div>
					)}

					<p className="pp-note">{t.promptpay.hint}</p>

					<div className="pp-actions">
						<button type="submit" className="btn btn-secondary btn-sm" disabled={saving}>
							{saving ? t.common.saving : saved ? t.promptpay.saved : t.common.save}
						</button>
						{payTo?.ready && (
							<button
								type="button"
								className="link-btn danger"
								disabled={saving}
								onClick={() => { setNumber(''); setName(''); }}
							>
								{t.promptpay.remove}
							</button>
						)}
					</div>
				</form>
			)}
		</div>
	);
}
