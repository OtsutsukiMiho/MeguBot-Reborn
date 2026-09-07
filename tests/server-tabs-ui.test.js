'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const tabsDir = path.join(root, 'app', 'components', 'Tabs');
const expectedTabs = [
	'AudioQueueTab.js',
	'AuditLogsTab.js',
	'AutomodTab.js',
	'AutoroleTab.js',
	'EmbedCreatorTab.js',
	'HoneypotTab.js',
	'MemberManagerTab.js',
	'NicknameManagerTab.js',
	'PersonalSettingsTab.js',
	'ReactionRolesTab.js',
	'RoleManagerTab.js',
	'VoiceTtsTab.js',
	'WelcomeTab.js',
];

for (const file of expectedTabs) {
	const source = fs.readFileSync(path.join(tabsDir, file), 'utf8');
	assert.match(source, /<TabWorkspace(?:\s|>)/, `${file} must use the shared server-tab workspace`);
	assert.match(source, /<(?:TabActionBar|TabSection)(?:\s|>)/, `${file} must open with shared task hierarchy`);
	assert.doesNotMatch(source, /(?:window\.)?confirm\s*\(/, `${file} must not use a native browser confirmation`);
	assert.doesNotMatch(source, /✕/, `${file} must use the shared icon system instead of a text close glyph`);
}

for (const file of ['AudioQueueTab.js', 'PersonalSettingsTab.js', 'ReactionRolesTab.js', 'RoleManagerTab.js']) {
	const source = fs.readFileSync(path.join(tabsDir, file), 'utf8');
	assert.match(source, /<TabConfirmDialog(?:\s|>)/, `${file} must protect destructive actions with an accessible dialog`);
}

for (const file of ['AudioQueueTab.js', 'MemberManagerTab.js', 'NicknameManagerTab.js', 'PersonalSettingsTab.js', 'RoleManagerTab.js']) {
	const source = fs.readFileSync(path.join(tabsDir, file), 'utf8');
	assert.match(source, /<TabModalLayer(?:\s|>)/, `${file} modals must render against the viewport`);
	assert.doesNotMatch(source, /position:\s*['"]fixed['"]/, `${file} must not trap a modal inside its tab panel`);
}

for (const file of ['MemberManagerTab.js', 'NicknameManagerTab.js']) {
	const source = fs.readFileSync(path.join(tabsDir, file), 'utf8');
	assert.match(source, /<TabMemberCard(?:\s|>)/, `${file} must use the shared banner-aware member card`);
}

const roleManagerSource = fs.readFileSync(path.join(tabsDir, 'RoleManagerTab.js'), 'utf8');
assert.match(roleManagerSource, /const PAGE_SIZES = \[10, 30, 50, 100\]/, 'Role Manager must offer the requested page sizes');
assert.match(roleManagerSource, /paginatedRoles\.map/, 'Role Manager must only render the active page');
assert.match(roleManagerSource, /Roles per page/, 'Role Manager must label its page-size control');

const selectSource = fs.readFileSync(path.join(root, 'app', 'components', 'CustomSelect.js'), 'utf8');
assert.match(selectSource, /aria-haspopup="listbox"/, 'CustomSelect must identify its popup');
assert.match(selectSource, /aria-expanded=\{isOpen\}/, 'CustomSelect must expose open state');
assert.match(selectSource, /role="option"/, 'CustomSelect options must be keyboard-operable controls');
assert.match(selectSource, /<ChevronDown/, 'CustomSelect must use the established icon library');

const workspaceCss = fs.readFileSync(path.join(tabsDir, 'tabWorkspace.module.css'), 'utf8');
assert.match(workspaceCss, /@media \(max-width: 760px\)/, 'Tab workspace must include a structural mobile layout');
assert.match(workspaceCss, /@media \(prefers-reduced-motion: reduce\)/, 'Tab workspace must respect reduced motion');
assert.match(workspaceCss, /:focus-visible/, 'Tab workspace must preserve visible keyboard focus');
assert.match(workspaceCss, /backdrop-filter:\s*blur\(/, 'Modal backdrops must blur the page behind them');
assert.match(workspaceCss, /background:\s*rgba\(13, 15, 21, 0\.64\)/, 'Modal backdrops must use a neutral grey scrim');

const workspaceSource = fs.readFileSync(path.join(tabsDir, 'TabWorkspace.js'), 'utf8');
assert.match(workspaceSource, /setPortalRoot\(document\.body\)/, 'Shared dialogs must target the document root');
assert.match(workspaceSource, /return createPortal\(/, 'Shared dialogs must render through a portal');
assert.match(workspaceSource, /export function TabModalLayer/, 'Legacy tab modals must share the viewport portal layer');
assert.match(workspaceSource, /member\?\.banner/, 'Member cards must render Discord profile banners when available');

const voiceTtsSource = fs.readFileSync(path.join(tabsDir, 'VoiceTtsTab.js'), 'utf8');
assert.match(voiceTtsSource, /tts_join_greeting_enabled/, 'Voice automation must expose the first-join room greeting');
assert.match(voiceTtsSource, /onChange\('tts_join_greeting_enabled', event\.target\.checked\)/, 'The room greeting checkbox must update the persisted config key');
assert.doesNotMatch(voiceTtsSource, /Play sample|tts-preview|SampleButton/, 'Voice automation must not expose sample playback controls');

const botSource = fs.readFileSync(path.join(root, 'backend', 'bot', 'bot.js'), 'utf8');
assert.match(botSource, /banner:\s*\(u\.bannerURL/, 'Dashboard member data must include cached Discord banners');
assert.match(botSource, /voiceGreetingGuard\.reset\(guild\.id, oldState\.channelId\)/, 'An empty voice channel must reset its room greeting session');

const webSource = fs.readFileSync(path.join(root, 'backend', 'web', 'web.js'), 'utf8');
const configPageSource = fs.readFileSync(path.join(root, 'app', 'servers', '[guildId]', 'page.js'), 'utf8');
assert.match(webSource, /tts_join_greeting_enabled:\s*toBooleanSetting\(vars\.tts_join_greeting_enabled, false\)/, 'Room greeting settings must be returned as a stable boolean');
assert.match(webSource, /setGuildVar\(guildId, 'tts_join_greeting_text'/, 'Custom room greeting text must persist');
assert.match(webSource, /greetingWasStored/, 'Room greeting saves must be confirmed by a database readback');
assert.match(webSource, /tts_join_greeting_enabled:\s*roomGreetingEnabled/, 'The save response must return the confirmed room greeting state');
assert.match(configPageSource, /configResult\.config/, 'The page must adopt the server-confirmed configuration after saving');
assert.match(configPageSource, /body:\s*JSON\.stringify\(config\)/, 'The save request must include the complete voice configuration');
assert.match(workspaceSource, /if \(!open \|\| !portalRoot\) return undefined/, 'Dialog focus handling must wait until the portal is mounted');

const serverCss = fs.readFileSync(path.join(root, 'app', 'servers', 'servers.module.css'), 'utf8');
const contentAnimation = serverCss.match(/@keyframes contentIn\s*\{([\s\S]*?)\n\}/)?.[1] || '';
assert.doesNotMatch(contentAnimation, /transform\s*:/, 'The tab entrance animation must not trap fixed modals inside the tab panel');
assert.match(serverCss, /\.heroStatus \.readyBadge\s*\{[\s\S]*?background:\s*var\(--settled-soft\)/, 'Connected server state must use a visible success treatment');
assert.match(serverCss, /\.serverFacts dt\s*\{[^}]*font-size:\s*clamp\(\.72rem/, 'Server fact labels must remain readable');
assert.match(serverCss, /\.serverFacts dd\s*\{[^}]*font-size:\s*clamp\(1\.05rem/, 'Server fact values must have clear hierarchy');
for (const actionClass of ['cardActionInvite', 'cardActionWorkspace', 'cardActionPersonal']) {
	assert.match(serverCss, new RegExp(`\\.${actionClass}\\s*\\{`), `Server cards must style ${actionClass} distinctly`);
}

const serversPageSource = fs.readFileSync(path.join(root, 'app', 'servers', 'page.js'), 'utf8');
assert.match(serversPageSource, /styles\.cardActionInvite/, 'Invite actions must use their semantic treatment');
assert.match(serversPageSource, /styles\.cardActionWorkspace/, 'Workspace actions must use their semantic treatment');
assert.match(serversPageSource, /styles\.cardActionPersonal/, 'Personal settings actions must use their semantic treatment');

console.log(`server tabs UI: ${expectedTabs.length} tools share one responsive, accessible workspace`);
