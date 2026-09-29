'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const babel = require('next/dist/compiled/babel/core');
const filename = path.join(__dirname, '../app/components/teams/GoalReviewerForm.js');
const first = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, configFile: false, babelrc: false, presets: ['next/babel'] });
const { code } = babel.transformSync(first.code, { filename, configFile: false, babelrc: false, plugins: ['next/dist/compiled/babel/plugin-transform-modules-commonjs'] });
(async () => {
	for (const lang of ['en', 'th']) {
		const t = require(`../app/copy/${lang}`); const module = { exports: {} };
		let index = 0; let draftRevision = null;
		const members = [{ userId: 'subject', displayName: 'Excluded subject', role: 'owner' }, { userId: 'member', displayName: 'Excluded member', role: 'member' }, { userId: 'admin', displayName: 'Eligible reviewer', role: 'admin' }];
		vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(id => {
			if (id === 'react') return { ...React, useState: initial => { const current = index++; return [current === 0 ? 'admin' : current === 1 ? 'Previous reviewer left' : current === 2 ? draftRevision : initial, () => {}]; } };
			if(id.includes('useDraftGuard')) return {default:()=>()=>{},requestDraftNavigation:()=>true,__esModule:true};
		if (id === '../../copy') return { useCopy: () => ({ t }) };
			if (id.endsWith('.css') || id.endsWith('.mjs')) return {};
			if (id.includes('CustomSelect')) return { default: props => React.createElement('div', { 'aria-label': props.ariaLabel }, props.options.map(option => React.createElement('span', { key: option.value }, option.label))), __esModule: true };
			return require(id.startsWith('@babel/runtime/') ? `next/dist/compiled/${id}` : id);
		}, module, module.exports);
		const render = (allowed, reviewerId = null) => { index = 0; return renderToStaticMarkup(React.createElement(module.exports.default, { goal: { subjectId: 'subject', reviewerId, revision: 4 }, members, allowed, busy: false, onAssign: async () => false })); };
		assert.equal(render(false), '');
		let html = render(true); assert.ok(html.includes('Eligible reviewer')); assert.ok(!html.includes('Excluded'));
		assert.ok(html.includes(t.teamGoals.assignHint)); assert.ok(html.includes(t.teamGoals.reassignReason));
		draftRevision = 3; html = render(true); assert.ok(html.includes(t.teamGoals.conflict)); assert.match(html, /type="submit"[^>]*disabled=""/);
		draftRevision = null; html = render(true, 'admin'); assert.ok(html.includes(t.teamGoals.changeReviewer)); assert.ok(html.includes('<details')); assert.ok(!html.includes('Eligible reviewer'), 'Current reviewer cannot be selected again');
	}
	const { loadTeamGoalMembers } = await import('../app/components/teams/loadTeamGoalMembers.mjs');
	const urls = [];
	const members = await loadTeamGoalMembers('team/encoded', async url => { urls.push(url); return { members: [{ userId: String(urls.length) }], nextOffset: urls.length === 1 ? 100 : null }; });
	assert.equal(members.length, 2); assert.ok(urls[0].includes('team%2Fencoded')); assert.ok(urls[1].endsWith('offset=100'));
	await assert.rejects(loadTeamGoalMembers('team', async () => ({ members: [], nextOffset: 0 })));
	await assert.rejects(loadTeamGoalMembers('team', async () => ({ members: [], nextOffset: 500 })));
	await assert.rejects(loadTeamGoalMembers('team', async () => ({ members: new Array(101), nextOffset: null })));
	console.log('Reviewer UI passed: bilingual consent warning, eligible options, stale draft protection and bounded roster loading');
})().catch(error => { console.error(error); process.exitCode = 1; });
