'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const babel = require('next/dist/compiled/babel/core');
const filename = path.join(__dirname, '../app/components/teams/CreateTeamGoal.js');
const first = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, configFile: false, babelrc: false, presets: ['next/babel'] });
const { code } = babel.transformSync(first.code, { filename, configFile: false, babelrc: false, plugins: ['next/dist/compiled/babel/plugin-transform-modules-commonjs'] });
for (const lang of ['en', 'th']) {
	const t = require(`../app/copy/${lang}`);
	const module = { exports: {} };
	let stateIndex = 0; let kind = 'numeric'; let role = 'member'; let uncertain = false;
	const members = [{ userId: 'subject', displayName: 'Subject', role: 'member' }, { userId: 'owner', displayName: 'Owner', role: 'owner' }, { userId: 'other', displayName: 'Other member', role: 'member' }];
	vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(function dependency(id) {
		if (id === 'react') return { ...React, useEffect() {}, useRef: value => ({ current: value }), useState: initial => { const index = stateIndex++; return [index === 0 ? { me: { userId: 'subject', role }, members } : index === 3 ? { ...initial, subjectId: 'subject', kind } : index === 8 ? uncertain : initial, () => {}]; } };
		if(id.includes('useDraftGuard')) return {default:()=>()=>{},requestDraftNavigation:()=>true,__esModule:true};
		if (id === '../../copy') return { useCopy: () => ({ t, lang }) };
		if (id === './TeamWorkspaceNav') return {default:()=>null,__esModule:true};
		if (id.endsWith('.css')) return {};
		if (id === 'next/link') return { default: props => React.createElement('a', props), __esModule: true };
		if (id === 'next/navigation') return { useRouter: () => ({ push() {} }) };
		if (id.includes('CustomSelect')) return { default: props => React.createElement('div', { 'aria-label': props.ariaLabel, 'data-disabled': props.disabled }, props.options.map(option => React.createElement('span', { key: option.value }, option.label))), __esModule: true };
		if (id.includes('AuthGate')) return { default: () => null, __esModule: true };
		if (id === './loadTeamGoalMembers.mjs') return {};
		if (id === './GoalTermsFields') {
			const fieldsFile = path.join(path.dirname(filename), 'GoalTermsFields.js');
			const first = babel.transformSync(fs.readFileSync(fieldsFile, 'utf8'), { filename: fieldsFile, configFile: false, babelrc: false, presets: ['next/babel'] });
			const compiled = babel.transformSync(first.code, { filename: fieldsFile, configFile: false, babelrc: false, plugins: ['next/dist/compiled/babel/plugin-transform-modules-commonjs'] });
			const fieldsModule = { exports: {} };
			vm.runInThisContext(`(function(require,module,exports){${compiled.code}\n})`, { filename: fieldsFile })(dependency, fieldsModule, fieldsModule.exports);
			return fieldsModule.exports;
		}
		return require(id.startsWith('@babel/runtime/') ? `next/dist/compiled/${id}` : id);
	}, module, module.exports);
	const render = () => { stateIndex = 0; return renderToStaticMarkup(React.createElement(module.exports.default, { teamId: 'team' })); };
	let html = render();
	assert.ok(html.includes(t.teamGoals.saveDraft)); assert.ok(html.includes('type="number"'));
	assert.ok(!html.includes('Other member'), 'Ordinary members cannot select another subject or an ineligible reviewer');
	assert.ok(html.includes('Owner'), 'Eligible reviewer is available');
	role = 'admin'; assert.ok(render().includes('Other member'));
	kind = 'milestone'; html = render(); assert.ok(html.includes(t.teamGoals.criteria)); assert.ok(!html.includes('type="number"'));
	uncertain = true; html = render();
	assert.ok(html.includes(t.teamGoals.retryCreate));
	assert.match(html, /type="submit" class="btn btn-primary"[^>]*>[^<]+<\/button>/, 'An uncertain save remains retryable');
	assert.ok(html.includes('disabled=""'), 'The original uncertain payload stays frozen');
	assert.equal(module.exports.canonicalGoalDate('2569-09-21'), '2026-09-21');
	assert.equal(module.exports.canonicalGoalDate('2026-09-21'), '2026-09-21');
	assert.equal(module.exports.canonicalGoalDate(''), '');
}
console.log('Goal creation UI passed: bilingual numeric/milestone forms, subject/reviewer filtering, Thai date conversion');
