'use client';

import { useState } from 'react';
import { useCopy } from '../copy';

const EMPTY = {
	type: 'bank_transfer',
	label: '',
	destination: '',
	accountName: '',
	url: '',
	instructions: '',
};

export default function PaymentOptionsSetup({ options, busy, call }) {
	const { t } = useCopy();
	const [items, setItems] = useState(() => options.filter(option => option.source === 'activity'));
	const [draft, setDraft] = useState(EMPTY);
	const [saving, setSaving] = useState(false);
	const copy = t.paymentMethods;

	const needsDestination = draft.type === 'bank_transfer';
	const needsUrl = draft.type === 'payment_link';
	const valid = draft.label.trim()
		&& (!needsDestination || draft.destination.trim())
		&& (!needsUrl || draft.url.trim());

	function addOption() {
		if (!valid) return;
		setItems(previous => [...previous, {
			type: draft.type,
			label: draft.label.trim(),
			destination: draft.destination.trim() || null,
			accountName: draft.accountName.trim() || null,
			url: draft.url.trim() || null,
			instructions: draft.instructions.trim() || null,
		}]);
		setDraft(EMPTY);
	}

	async function save() {
		setSaving(true);
		try {
			const result = await call('PUT', '/payment-options', { paymentOptions: items });
			if (result?.activity) {
				setItems(result.activity.paymentOptions.filter(option => option.source === 'activity'));
			}
		}
		finally {
			setSaving(false);
		}
	}

	return (
		<section className="payment-options-setup">
			<div className="field-label">{copy.title}</div>
			<p className="field-hint">{copy.hint}</p>

			{items.length > 0 && (
				<div className="payment-option-list">
					{items.map((option, index) => (
						<div className="pay-copy-row" key={option.id || `${option.type}-${index}`}>
							<div>
								<span className="pay-number">{option.label}</span>
								<span className="pay-account">{copy.types[option.type]}</span>
							</div>
							<button type="button" className="link-btn danger" disabled={busy || saving} onClick={() => setItems(previous => previous.filter((_, itemIndex) => itemIndex !== index))}>
								{t.common.remove}
							</button>
						</div>
					))}
				</div>
			)}

			<div className="form-stack payment-option-form">
				<label className="field">
					<span className="field-label">{copy.typeField}</span>
					<select className="form-control" value={draft.type} onChange={event => setDraft(previous => ({ ...previous, type: event.target.value }))}>
						{Object.entries(copy.types).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
					</select>
				</label>
				<label className="field">
					<span className="field-label">{copy.labelField}</span>
					<input className="form-control" maxLength={60} value={draft.label} onChange={event => setDraft(previous => ({ ...previous, label: event.target.value }))} placeholder={copy.labelPlaceholder} />
				</label>
				{needsDestination && (
					<>
						<label className="field">
							<span className="field-label">{copy.destinationField}</span>
							<input className="form-control" value={draft.destination} onChange={event => setDraft(previous => ({ ...previous, destination: event.target.value }))} placeholder={copy.destinationPlaceholder} />
						</label>
						<label className="field">
							<span className="field-label">{copy.accountNameField}</span>
							<input className="form-control" value={draft.accountName} onChange={event => setDraft(previous => ({ ...previous, accountName: event.target.value }))} />
						</label>
					</>
				)}
				{needsUrl && (
					<label className="field">
						<span className="field-label">{copy.urlField}</span>
						<input className="form-control" type="url" value={draft.url} onChange={event => setDraft(previous => ({ ...previous, url: event.target.value }))} placeholder="https://" />
					</label>
				)}
				<label className="field">
					<span className="field-label">{copy.instructionsField}</span>
					<textarea className="form-control" maxLength={500} value={draft.instructions} onChange={event => setDraft(previous => ({ ...previous, instructions: event.target.value }))} placeholder={copy.instructionsPlaceholder} />
				</label>
				<button type="button" className="btn btn-secondary btn-block" disabled={!valid || busy || saving} onClick={addOption}>{copy.add}</button>
				<button type="button" className="btn btn-primary btn-block" disabled={busy || saving} onClick={save}>{saving ? t.common.saving : copy.save}</button>
			</div>
		</section>
	);
}
