'use client';

import { useEffect, useState } from 'react';
import { useCopy } from '../copy';

// Where people can pay you.
//
// The question this screen answers is the payer's — *where do I send this?* —
// so it is written that way rather than as configuration. Megu never holds the
// money and has no account to set up; a method is an address and, sometimes, a
// sentence about how to use it.
//
// Two things the old form got wrong and this one does not. It asked every
// question for every type, so adding "cash" meant looking at an account-number
// field and a URL field and working out that neither applied. And it showed the
// details as a form, never as what the other person would end up looking at —
// which is the only version that catches a digit typed wrong, because it is the
// version a human reads.

const FIELDS = {
	promptpay: ['destination', 'accountName', 'instructions'],
	bank_transfer: ['destination', 'accountName', 'instructions'],
	payment_link: ['url', 'instructions'],
	cash: ['instructions'],
	custom: ['destination', 'accountName', 'instructions'],
};

const EMPTY = { type: 'promptpay', label: '', destination: '', accountName: '', url: '', instructions: '' };

/**
 * What a participant will be looking at.
 *
 * Deliberately not a summary of the form: it is the same shape the payment
 * screen renders, with the same name and the same digits, so reading it is the
 * check. A preview that paraphrases would agree with a wrong account number
 * just as happily as with a right one.
 */
function Preview({ draft, t }) {
	const shown = draft.label.trim() || t.paymentMethods.types[draft.type];
	return (
		<div className="method-preview" aria-live="polite">
			<span className="method-preview-tag">{t.paymentMethods.previewTitle}</span>
			<div className="method-preview-body">
				<div className="method-preview-label">{shown}</div>
				{draft.accountName.trim() && <div className="method-preview-name">{draft.accountName.trim()}</div>}
				{draft.type === 'payment_link' && draft.url.trim() && (
					<div className="method-preview-line">{draft.url.trim()}</div>
				)}
				{['promptpay', 'bank_transfer', 'custom'].includes(draft.type) && draft.destination.trim() && (
					<div className="method-preview-line">{draft.destination.trim()}</div>
				)}
				{draft.instructions.trim() && <p className="method-preview-note">{draft.instructions.trim()}</p>}
				{!draft.destination.trim() && !draft.url.trim() && draft.type !== 'cash' && (
					<p className="method-preview-note quiet-note">{t.paymentMethods.previewEmpty}</p>
				)}
			</div>
		</div>
	);
}

export default function PaymentMethods() {
	const { t } = useCopy();
	const copy = t.paymentMethods;
	const [methods, setMethods] = useState(null);
	const [draft, setDraft] = useState(EMPTY);
	const [editing, setEditing] = useState(null);
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState('');

	useEffect(() => {
		fetch('/api/megu/me/payment-methods', { credentials: 'same-origin' })
			.then(r => r.json())
			.then(d => setMethods(d.paymentMethods || []))
			.catch(() => setMethods([]));
	}, []);

	async function call(method, path, body) {
		setBusy(true);
		setProblem('');
		try {
			const res = await fetch(`/api/megu/me/payment-methods${path}`, {
				method,
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: body ? JSON.stringify(body) : undefined,
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				setProblem(t.errors[data.code] || data.message || t.errors.failed);
				return false;
			}
			setMethods(data.paymentMethods || []);
			return true;
		}
		catch {
			setProblem(t.errors.offline);
			return false;
		}
		finally {
			setBusy(false);
		}
	}

	async function submit(event) {
		event.preventDefault();
		const payload = { type: draft.type, label: draft.label, instructions: draft.instructions };
		if (FIELDS[draft.type].includes('destination')) payload.destination = draft.destination;
		if (FIELDS[draft.type].includes('accountName')) payload.accountName = draft.accountName;
		if (FIELDS[draft.type].includes('url')) payload.url = draft.url;

		const done = editing
			? await call('PATCH', `/${editing}`, payload)
			: await call('POST', '', payload);
		if (done) {
			setDraft(EMPTY);
			setEditing(null);
		}
	}

	if (!methods) return <p className="quiet-note">{t.common.loading}</p>;

	const fields = FIELDS[draft.type];

	return (
		<div className="stack-md">
			{problem && <div className="error-note">{problem}</div>}

			{methods.length === 0 ? (
				<p className="quiet-note">{copy.empty}</p>
			) : (
				<ul className="method-list">
					{methods.map((method, index) => (
						<li key={method.id} className="method-row">
							<div className="method-row-main">
								<div className="method-row-label">
									{method.label}
									{/* First is what gets offered first, so that is what
									    "default" means here — there is no second flag to
									    disagree with the order. */}
									{index === 0 && <span className="chip chip-clear chip-sm">{copy.defaultTag}</span>}
								</div>
								<div className="method-row-detail">
									{copy.types[method.type]}
									{method.destination && ` · ${method.destination}`}
									{method.url && ` · ${method.url}`}
								</div>
							</div>
							<div className="method-row-actions">
								{index > 0 && (
									<button
										type="button"
										className="btn btn-quiet"
										disabled={busy}
										onClick={() => call('PUT', '/order', { methodIds: [method.id, ...methods.filter(m => m.id !== method.id).map(m => m.id)] })}
									>
										{copy.makeDefault}
									</button>
								)}
								<button
									type="button"
									className="btn btn-sm btn-secondary"
									disabled={busy}
									onClick={() => {
										setEditing(method.id);
										setDraft({
											type: method.type,
											label: method.label,
											destination: method.destination || '',
											accountName: method.accountName || '',
											url: method.url || '',
											instructions: method.instructions || '',
										});
									}}
								>
									{t.common.edit}
								</button>
								<button
									type="button"
									className="btn btn-sm btn-danger"
									disabled={busy}
									onClick={() => call('DELETE', `/${method.id}`)}
								>
									{t.common.remove}
								</button>
							</div>
						</li>
					))}
				</ul>
			)}

			<form className="stack-sm method-form" onSubmit={submit}>
				<div className="field-label">{editing ? copy.editTitle : copy.addTitle}</div>

				<div className="method-types" role="group" aria-label={copy.typeField}>
					{Object.keys(FIELDS).map(type => (
						<button
							key={type}
							type="button"
							className={`chip chip-choice ${draft.type === type ? 'is-on' : ''}`}
							aria-pressed={draft.type === type}
							onClick={() => setDraft(d => ({ ...d, type }))}
						>
							{copy.types[type]}
						</button>
					))}
				</div>

				<input
					className="form-control"
					placeholder={copy.labelPlaceholder}
					aria-label={copy.labelField}
					value={draft.label}
					onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
				/>

				{/* Only the fields this type actually uses. Switching type swaps
				    them, and anything the new type has no use for is dropped by
				    the server rather than carried along invisibly. */}
				{fields.includes('destination') && (
					<input
						className="form-control"
						placeholder={copy.destinationPlaceholderFor[draft.type] || copy.destinationPlaceholder}
						aria-label={copy.destinationFieldFor[draft.type] || copy.destinationField}
						value={draft.destination}
						onChange={e => setDraft(d => ({ ...d, destination: e.target.value }))}
					/>
				)}
				{fields.includes('url') && (
					<input
						className="form-control"
						type="url"
						inputMode="url"
						placeholder="https://"
						aria-label={copy.urlField}
						value={draft.url}
						onChange={e => setDraft(d => ({ ...d, url: e.target.value }))}
					/>
				)}
				{fields.includes('accountName') && (
					<input
						className="form-control"
						placeholder={copy.accountNamePlaceholder}
						aria-label={copy.accountNameField}
						value={draft.accountName}
						onChange={e => setDraft(d => ({ ...d, accountName: e.target.value }))}
					/>
				)}
				{fields.includes('instructions') && (
					<textarea
						className="form-control"
						rows={2}
						placeholder={copy.instructionsPlaceholder}
						aria-label={copy.instructionsField}
						value={draft.instructions}
						onChange={e => setDraft(d => ({ ...d, instructions: e.target.value }))}
					/>
				)}

				<Preview draft={draft} t={t} />

				<div className="share-row">
					<button type="submit" className="btn btn-primary" disabled={busy || !draft.label.trim()}>
						{editing ? t.common.save : copy.add}
					</button>
					{editing && (
						<button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setEditing(null); setDraft(EMPTY); }}>
							{t.common.cancel}
						</button>
					)}
				</div>
			</form>
		</div>
	);
}
