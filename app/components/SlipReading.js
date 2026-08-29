'use client';

import { useCopy } from '../copy';
import { bankFor } from '../../core/slip.js';

/**
 * What the slip appeared to say, shown as a reading rather than as a fact.
 *
 * Two different kinds of thing are on this line and the difference is the whole
 * design. The bank came out of the slip's own QR — checksummed, issued by that
 * bank, and as solid as anything here gets. The amount and the time came out of
 * OCR on a photograph, and a confident misreading looks exactly like a correct
 * one. So the bank is stated plainly, the reading is labelled as a reading, and
 * the caveat underneath is not removable by a good result.
 *
 * The one genuinely useful signal is the comparison: a figure read off the
 * picture that matches the figure that was asked for is two independent sources
 * agreeing. It still does not prove the money moved — only a bank can say that,
 * and Megu deliberately never asks one — but it turns confirming a payment from
 * a trip to a banking app into a glance.
 */
export default function SlipReading({ slip, expectedSatang }) {
	const { t, fmt, lang } = useCopy();

	const bank = slip?.slipBank ? bankFor(slip.slipBank) : null;
	const read = slip?.slipAmountSatang ?? null;
	const matches = read != null && expectedSatang != null ? read === expectedSatang : null;

	if (!bank && read == null && !slip?.slipWhen) return null;

	return (
		<div className="slip-reading">
			{bank && <span className="chip chip-clear">{t.slip.sentFrom(bank[lang] || bank.en)}</span>}

			{read != null && (
				<span className={`chip ${matches === false ? 'chip-due' : 'chip-clear'}`}>
					{matches === false
						? t.slip.readDiffers(fmt.money(read), fmt.money(expectedSatang))
						: t.slip.readAmount(fmt.money(read))}
				</span>
			)}

			{slip?.slipWhen && <span className="slip-when">{slip.slipWhen}</span>}

			{/* Never conditional on how well it went. A reading that happens to
			    be right this time is still a reading. */}
			{read != null && <small className="quiet-note">{t.slip.readNote}</small>}
		</div>
	);
}
