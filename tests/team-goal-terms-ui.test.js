'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const babel = require('next/dist/compiled/babel/core');
const directory = path.join(__dirname, '../app/components/teams');
for (const lang of ['en', 'th']) {
	const t = require(`../app/copy/${lang}`); let stateIndex = 0; let revision = null;
	const goal = { title: 'Agreed target', successDescription: 'Accepted work', periodStart: '2026-09-01', periodEnd: '2026-09-30', timezone: 'UTC', revision: 4, measurement: { kind: 'numeric', baseline: 0, target: 10, current: 15, unit: 'items', direction: 'increase' } };
	let terms;
	function load(name) {
		const filename = path.join(directory, `${name}.js`);
		const first = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, configFile: false, babelrc: false, presets: ['next/babel'] });
		const { code } = babel.transformSync(first.code, { filename, configFile: false, babelrc: false, plugins: ['next/dist/compiled/babel/plugin-transform-modules-commonjs'] });
		const module = { exports: {} };
		vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(id => {
			if (id === 'react') return { ...React, useEffect() {}, useState: initial => { const index = stateIndex++; return [index === 0 ? terms : index === 1 ? 'Changed scope' : index === 2 ? revision : initial, () => {}]; } };
			if(id.includes('useDraftGuard')) return {default:()=>()=>{},requestDraftNavigation:()=>true,__esModule:true};
		if (id === '../../copy') return { useCopy: () => ({ t }) };
			if (id.endsWith('.css')) return {};
			if (id === './GoalTermsFields') return load('GoalTermsFields');
			if (id.includes('CustomSelect')) return { default: props => React.createElement('div', { 'aria-label': props.ariaLabel }, props.options.map(option => React.createElement('span', { key: option.value }, option.label))), __esModule: true };
			return require(id.startsWith('@babel/runtime/') ? `next/dist/compiled/${id}` : id);
		}, module, module.exports);
		return module.exports;
	}
	const editor = load('GoalTermsEditor'); const fields = load('GoalTermsFields');
	terms = editor.editableGoalTerms(goal);
	assert.equal(terms.current, undefined);
	const payload = fields.goalTermsPayload(terms);
	assert.equal(payload.measurement.current, undefined); assert.equal(payload.measurement.target, 10);
	assert.equal(fields.goalTermsPayload({ ...terms, periodStart: '2569-09-01' }).periodStart, '2026-09-01');
	const render = capabilities => { stateIndex = 0; return renderToStaticMarkup(React.createElement(editor.default, { goal, capabilities, busy: false, onTransition: async () => false })); };
	assert.equal(render({}), '');
	assert.ok(render({ canEdit: true }).includes(t.teamGoals.editTerms));
	assert.ok(render({ canRevise: true }).includes(t.teamGoals.reviseHint));
	assert.ok(render({ canRevise: true }).includes(t.teamGoals.termReason));
	revision = 3; const html = render({ canEdit: true });
	assert.ok(html.includes(t.teamGoals.conflict)); assert.match(html, /type="submit"[^>]*disabled=""/);
}
console.log('Goal term UI passed: shared fields, draft/revision permissions, stale form gate, Thai dates, no copied reported value');
