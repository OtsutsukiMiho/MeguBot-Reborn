// Who ate what, turned into expenses the server already understands.
//
// A restaurant bill is not one amount shared by everyone. The ฿420 steak was
// one person's, the ฿180 salad was two people's, and the service charge
// belongs to everybody in proportion to what they ordered. Dividing the total
// evenly is the shortcut people take because the tool made them, and it is
// the reason the friend who had water ends up paying for the wine.
//
// This plans a receipt as one expense per line: a dish is split evenly among
// the people who shared it, and a charge (service, VAT) is split by weight,
// the weight being each person's dish subtotal. It uses the same `resolveSplit`
// the server uses, so the per-person preview shown before saving is exactly —
// to the satang — what the server will record.

const { resolveSplit } = require('./split.js');

/**
 * @param {object} input
 * @param {Array<{label: string, amountSatang: number, kind?: 'dish'|'charge', sharers?: string[]}>} input.lines
 * @param {string[]} input.everyone  who a line is shared by when it names nobody
 * @returns {{ expenses: Array, perPerson: Record<string, number>, totalSatang: number }}
 */
function planReceipt({ lines = [], everyone = [] } = {}) {
	const everybody = [...new Set(everyone)];
	const dishes = [];
	const charges = [];
	for (const line of lines) {
		const amountSatang = Number(line.amountSatang);
		if (!Number.isInteger(amountSatang) || amountSatang <= 0) continue;
		const named = Array.isArray(line.sharers) ? [...new Set(line.sharers)].filter(id => everybody.includes(id)) : [];
		const entry = { label: line.label, amountSatang, sharers: named.length ? named : everybody };
		(line.kind === 'charge' ? charges : dishes).push(entry);
	}
	if (everybody.length === 0 && (dishes.length || charges.length)) throw new Error('split_people_required');

	const perPerson = Object.fromEntries(everybody.map(id => [id, 0]));
	const expenses = [];

	for (const dish of dishes) {
		const resolved = resolveSplit(dish.amountSatang, dish.sharers, { mode: 'even' });
		for (const [id, satang] of Object.entries(resolved.split)) perPerson[id] += satang;
		expenses.push({ label: dish.label, amountSatang: dish.amountSatang, shareParticipantIds: dish.sharers, split: { mode: 'even' } });
	}

	// Charges follow the food. Read before any charge is added, so a service
	// charge is never weighted by the VAT line, or the other way round.
	const food = { ...perPerson };
	for (const charge of charges) {
		const weighted = charge.sharers.filter(id => food[id] > 0);
		const spec = weighted.length
			? { mode: 'shares', values: Object.fromEntries(weighted.map(id => [id, food[id]])) }
			: { mode: 'even' };
		const sharers = weighted.length ? weighted : charge.sharers;
		const resolved = resolveSplit(charge.amountSatang, sharers, spec);
		for (const [id, satang] of Object.entries(resolved.split)) perPerson[id] += satang;
		expenses.push({ label: charge.label, amountSatang: charge.amountSatang, shareParticipantIds: sharers, split: spec });
	}

	const totalSatang = expenses.reduce((sum, expense) => sum + expense.amountSatang, 0);
	return { expenses, perPerson, totalSatang };
}

module.exports = { planReceipt };
