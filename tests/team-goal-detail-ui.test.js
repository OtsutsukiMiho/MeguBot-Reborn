'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const babel = require('next/dist/compiled/babel/core');
const filename = path.join(__dirname, '../app/components/teams/TeamGoalDetail.js');
const first = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, configFile: false, babelrc: false, presets: ['next/babel'] });
const { code } = babel.transformSync(first.code, { filename, configFile: false, babelrc: false, plugins: ['next/dist/compiled/babel/plugin-transform-modules-commonjs'] });
for (const lang of ['en', 'th']) {
	const t = require(`../app/copy/${lang}`);
	let hookIndex = 0;
	const participantMembers = [{ userId: 'subject', displayName: 'Goal member', avatarUrl: 'https://cdn.example/member.png' }, { userId: 'reviewer', displayName: 'Goal reviewer', avatarUrl: 'https://cdn.example/reviewer.png' }];
	const module = { exports: {} };
	const data = { access: 'private', goal: { title: 'Private delivery', subjectId: 'subject', reviewerId: 'reviewer', successDescription: 'Accepted work', version: 2, currentVersion: 3, periodStart: '2026-09-01', periodEnd: '2026-09-30', lifecycle: 'reviewed', measurement: { kind: 'numeric', baseline: 0, target: 10, current: 12, unit: 'items' }, achievement: 100, selfReview: 'Private self review' },
		updates: [{ id: 'u', createdAt: '2026-09-20T12:00:00Z', note: 'Private evidence', value: 12, links: ['https://example.com/evidence'] }], updatesNextOffset: 100,
		review: { outcome: 'exceeded', explanation: 'Private assessment', nextStep: 'Agree next target', publishedAt: '2026-09-20T12:00:00Z', authorName: 'Review author', authorAvatarUrl: 'https://cdn.discordapp.com/avatars/reviewer/example.png' },
		responses: [{ id: 'r', createdAt: '2026-09-20T12:00:00Z', acknowledged: true, response: 'Private response' }], responsesNextOffset: null };
	vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(id => {
		if (id === 'react') return { ...React, useState: initial => [hookIndex++ === 2 ? participantMembers : initial, () => {}] };
		if (id === '../../copy') return { useCopy: () => ({ t, lang }) };
		if (id === './TeamWorkspaceNav') return {default:()=>null,__esModule:true};
		if (id.endsWith('.css')) return {};
		if (id === 'next/link') return { default: props => React.createElement('a', props), __esModule: true };
		if (id === 'next/navigation') return { useRouter: () => ({ replace() {} }) };
		if (id.includes('useWorkspaceResource')) return { default: () => ({ data, loading: false }), __esModule: true };
		if (id.includes('AuthGate')) return { default: () => null, __esModule: true };
		if (id === './GoalActionForm') return { default: () => null, __esModule: true };
		if (id === './GoalReviewerForm') return { default: () => null, __esModule: true };
		if (id === '../WorkspaceSkeleton') return { default: () => React.createElement('div', { role: 'status' }), __esModule: true };
		if (id === './GoalTermsEditor') return { default: () => null, __esModule: true };
		if (id === './loadTeamGoalMembers.mjs') return { loadTeamGoalMembers: async () => [] };
		if (id.includes('ProjectAvatar')) return { default: props => React.createElement('img', { src: props.avatarUrl || undefined, alt: '' }), __esModule: true };
		return require(id.startsWith('@babel/runtime/') ? `next/dist/compiled/${id}` : id);
	}, module, module.exports);
	const render = () => { hookIndex = 0; return renderToStaticMarkup(React.createElement(module.exports.default, { teamId: 'team', goalId: 'goal', options: { updatesOffset: 50 } })); };
	let html = render();
	assert.ok(html.includes('Goal member')); assert.ok(html.includes('Goal reviewer'));
	assert.ok(html.includes('cdn.example/member.png')); assert.ok(html.includes('cdn.example/reviewer.png'));
	assert.ok(html.includes(t.teamGoals.success)); assert.ok(html.includes(t.teamGoals.measurement));
	assert.ok(html.includes(t.teamGoals.historyTitle));
	data.updates[0].reference = { access: 'available', projectCode: 'ABCDE', title: 'Authorized project', topicId: 'top_123', topicTitle: 'Authorized topic' };
	html = render(); assert.ok(html.includes('/p/ABCDE?topic=top_123')); assert.ok(html.includes('Authorized topic'));
	data.updates[0].reference = { access: 'unavailable' };
	html = render(); assert.ok(html.includes(t.teamGoals.referenceUnavailable)); assert.ok(!html.includes('Authorized project')); assert.ok(!html.includes('/p/ABCDE'));
	assert.ok(html.includes('Review author')); assert.ok(html.includes('cdn.discordapp.com')); assert.ok(html.includes('UTC'));
	for (const text of ['100%', '12 items', 'Private evidence', 'Private assessment', 'Private response', 'version=1', 'version=3', 'updatesOffset=100', 'noopener noreferrer']) assert.ok(html.includes(text), `${lang}: missing ${text}`);
	data.goal.measurement.current = null; data.goal.achievement = null;
	assert.ok(render().includes(t.teamGoals.unreported));
	data.goal.measurement = { kind: 'milestone', criteria: 'Accepted milestone' };
	html = render(); assert.ok(html.includes('Accepted milestone')); assert.ok(!html.includes('%'));
	data.access = 'proposal';
	html = render(); assert.ok(html.includes(t.teamGoals.proposal)); assert.ok(html.includes('Accepted milestone'));
	for (const text of ['Private evidence', 'Private assessment', 'Private self review', 'Private response']) assert.ok(!html.includes(text));
	data.access = 'administration';
	html = render(); assert.ok(html.includes(t.teamGoals.administration));
	for (const text of ['Private delivery', 'Accepted work', 'Accepted milestone', 'Private assessment']) assert.ok(!html.includes(text));
	data.access = 'private'; data.goal.reviewerId = null; data.goal.lifecycle = 'draft'; data.capabilities = { canPropose: true, canAccept: false };
	assert.ok(render().includes(t.teamGoals.propose));
	assert.ok(render().includes(t.teamGoals.personalOnly));
	data.goal.lifecycle = 'proposed'; data.goal.reviewerId = 'reviewer'; data.goal.subjectAcceptedAt = '2026-09-20T12:00:00Z';
	data.capabilities = { canPropose: false, canAccept: true };
	html = render(); assert.ok(html.includes(t.teamGoals.accept)); assert.ok(html.includes(t.teamGoals.subjectAccepted)); assert.ok(html.includes(t.teamGoals.reviewerPending));
	data.capabilities.canAccept = false;
	assert.ok(!render().includes(`>${t.teamGoals.accept}</button>`));
	data.goal.version = data.goal.currentVersion;
	html = render(); assert.ok(html.includes(t.teamGoals.currentStatus)); assert.ok(html.includes(t.teamGoals.responsibleLabel));
	data.goal.lifecycle = 'active'; data.goal.selfReview = 'Earlier submission'; data.capabilities = { canAddEvidence: true, canSubmit: true };
	html = render(); assert.ok(html.includes(t.teamGoals.returnedStatus)); assert.ok(html.includes(t.teamGoals.returnedGuidance));
	for (const lifecycle of ['archived', 'cancelled']) { data.goal.lifecycle = lifecycle; data.capabilities = {}; html = render(); assert.ok(html.includes(t.teamGoals.closedTitle)); assert.ok(html.includes(t.teamGoals.guidance.closed)); assert.ok(!html.includes(t.teamGoals.guidance.waiting)); }
	data.goal.selfReview = 'Private self review'; data.goal.lifecycle = 'proposed';
	for (const [capabilities, reviewerId, key] of [
		[{canPropose:true},'reviewer','propose'],[{canAccept:true},'reviewer','accept'],[{canAccept:true},null,'acceptPersonal'],
		[{canAddEvidence:true},'reviewer','evidence'],[{canAddEvidence:true},null,'personal'],
		[{canReview:true},'reviewer','review'],[{canRespond:true},'reviewer','respond'],[{},'reviewer','waitingReviewer'],
	]) { data.capabilities=capabilities; data.goal.reviewerId=reviewerId; assert.ok(render().includes(t.teamGoals.guidance[key])); }
	data.goal.needsReviewer=true; data.goal.reviewerId=null; data.capabilities={canReassignReviewer:true};assert.ok(render().includes(t.teamGoals.guidance.assign));
	data.goal.reviewerId='reviewer'; data.capabilities={canAccept:true,canReassignReviewer:true};html=render();assert.ok(html.includes(t.teamGoals.guidance.accept));assert.ok(html.includes(t.teamGoals.reviewerAssigned));assert.ok(!html.includes(t.teamGoals.needsReviewer));
	data.access='administration';assert.ok(render().includes(t.teamGoals.guidance.administrationAssigned));
	assert.ok(!render().includes(t.teamGoals.guidance.evidence));
	data.goal.version--;assert.ok(render().includes(t.teamGoals.guidance.history));
}
console.log('Goal detail UI passed: EN/TH version/history navigation, honest measurements, proposal and administration privacy');
