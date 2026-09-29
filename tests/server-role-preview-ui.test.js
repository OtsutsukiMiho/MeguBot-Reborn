'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const babel = require('next/dist/compiled/babel/core');
const filename = path.join(__dirname, '../app/components/teams/TeamRoleMapping.js');
const first = babel.transformSync(fs.readFileSync(filename, 'utf8') + '\nexport { RoleMemberPage, RoleSyncControls };', { filename, configFile: false, babelrc: false, presets: ['next/babel'] });
const { code } = babel.transformSync(first.code, { filename, configFile: false, babelrc: false, plugins: ['next/dist/compiled/babel/plugin-transform-modules-commonjs'] });
for (const lang of ['en', 'th']) {
	const t = require(`../app/copy/${lang}`);
	let stateIndex = 0;
	let restoration = null;
	let revision = 2;
	let syncStates = null;
	const reads=[];
	const module = { exports: {} };
	const candidates = [
		{ discordUserId: '1', userId: 'active', displayName: 'Existing', linkedAccount: true, teamRole: 'admin' },
		{ discordUserId: '2', userId: 'ready', displayName: 'Eligible', linkedAccount: true },
		{ discordUserId: '3', userId: 'removed', displayName: 'Removed', linkedAccount: true, restoreRequired: true },
		{ discordUserId: '4', displayName: 'Unregistered', linkedAccount: false },
		{ discordUserId: '5', userId: 'dismissed', displayName: 'Dismissed person', linkedAccount: true, dismissed: true },
	];
	vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(id => {
		if (id === 'react') return { ...React, useState: initial => [syncStates ? syncStates[stateIndex++] : stateIndex++ === 2 ? restoration : initial, () => {}] };
		if (id === '../../copy') return { useCopy: () => ({ t }) };
		if(id.includes('useDraftGuard'))return {default:()=>()=>{},requestDraftNavigation:()=>true,__esModule:true};
		if(id.includes('AuthGate'))return {default:()=>null,__esModule:true};
		if (id.endsWith('.css')) return {};
		if (id.includes('useWorkspaceResource')) return { default: url => {reads.push(url);return { data: url.includes('/role-mappings/') ? {mapping:{id:'mapping',revision,enabled:true,mode:'approval',roles:[{id:'123456789012345678',name:'Development'}]}} : { revision, candidates, partial: true, nextOffset: 30 }, loading: false, reload() {} };}, __esModule: true };
		if (id.includes('ProjectAvatar')) return { default: () => React.createElement('img', { alt: '' }), __esModule: true };
		if (id.includes('CustomSelect')) return { default: () => null, __esModule: true };
		return require(id.startsWith('@babel/runtime/') ? `next/dist/compiled/${id}` : id);
	}, module, module.exports);
	const render = () => { stateIndex = 0; return renderToStaticMarkup(React.createElement(module.exports.RoleMemberPage, { endpoint: '/test', revision: 2, explain: () => 'Error', disabled: false })); };
	const html = render();
	stateIndex=0;
	const management=renderToStaticMarkup(React.createElement(module.exports.default,{serverManagement:true,team:{id:'known',discordGuild:{id:'811111111111111111'}},readError:()=> 'Error'}));
	assert.deepEqual(reads.slice(-2),['/api/megu/teams/discord-guilds/811111111111111111/role-mappings/known','/api/megu/teams/discord-guilds/811111111111111111/role-mappings/known/sync']);
	assert.ok(management.includes(t.roleMappings.approved));assert.ok(management.includes('Development'));assert.ok(management.includes('123456789012345678'));assert.ok(management.includes(t.roleMappings.discordRoleId));assert.ok(management.includes(t.roleMappings.roleLinkReviewHint));
	assert.ok(!management.includes(t.roleMappings.membersTitle),'Server management cannot preview private team members');
	assert.ok(!management.includes(`>${t.roleMappings.approve}</button>`),'Server management cannot exercise team-owner consent');
	for (const text of [t.roleMappings.partialHint, t.roleMappings.reviewRestore, t.teams.needsMeguAccount, t.teams.alreadyTeamMember]) assert.ok(html.includes(text), `${lang}: missing ${text}`);
	assert.ok(html.includes(t.roleMappings.dismissed));
	assert.ok(html.includes(t.roleMappings.resetSuggestion));
	assert.ok(!html.includes(`aria-label="${t.roleMappings.approveMember}: Dismissed person`), 'Dismissed suggestions cannot be approved until explicitly reset');
	assert.ok(html.includes(`aria-label="${t.roleMappings.approveMember}: Eligible`));
	restoration = 'removed';
	assert.ok(render().includes(t.roleMappings.confirmRestore));
	assert.ok(render().includes(`aria-label="${t.roleMappings.confirmRestore}: Removed`));
	assert.ok(render().includes(t.roleMappings.restoreHint));
	revision = 3;
	const stale = render();
	assert.ok(stale.includes(t.roleMappings.changed));
	assert.match(stale, /disabled="" aria-label=/, 'Stale configuration disables approval');
	const sync=t.roleMappings.sync;
	const syncStatus={supported:true,policyVersion:1,capability:{available:true},revision:2,pendingDelegation:true,canConfirmTransitions:true,jobs:[],blockedRevocations:[]};
	const syncProps={team:{id:'known'},mapping:{mode:'approval'},endpoint:'/test',resource:{data:syncStatus,reload(){}},explain:()=> 'Error',onChanged(){}};
	const renderSync=overrides=>{stateIndex=0;return renderToStaticMarkup(React.createElement(module.exports.RoleSyncControls,{...syncProps,...overrides}));};
	syncStates=[null,false,false,'','',false];
	assert.ok(renderSync({serverManagement:true}).includes(sync.request));
	assert.ok(!renderSync({serverManagement:true}).includes(`>${sync.review}</button>`),'Manager cannot confirm owner consent');
	assert.ok(renderSync({serverManagement:false}).includes(`>${sync.review}</button>`));
	assert.ok(!renderSync({resource:{data:{...syncStatus,canConfirmTransitions:false}}}).includes(`>${sync.review}</button>`),'Native admin cannot confirm owner consent');
	syncStates=[{action:'enable',revision:2,impact:{derivedSources:0,finalSources:0,ownershipBlocks:0},memberPreview:{candidates,partial:true,nextOffset:null}},false,false,'','',false];
	const partial=renderSync({});assert.ok(partial.includes(sync.partial));assert.ok(partial.includes(sync.unregistered));assert.match(partial,/disabled="">[^<]+<\/button>/,'Explicit acknowledgement is required');
	syncStates=[null,false,false,'','',true];assert.ok(renderSync({serverManagement:true}).includes(sync.retrySave));assert.ok(!renderSync({serverManagement:true}).includes(`>${sync.request}</button>`),'Uncertain request is frozen');
}
console.log('Role preview UI passed: EN/TH account states, restoration confirmation, stale approval disabled');
