'use strict';

const assert = require('node:assert/strict');
const { emptyServerToolDrafts, getLocalDraftToolIds } = require('../core/server-dashboard-drafts');

const empty = emptyServerToolDrafts();
assert.deepStrictEqual([...getLocalDraftToolIds(empty)], [], 'default editor values must not create a false unsaved warning');

const audioDraft = { ...empty, audioqueue: { text: 'Keep this message', engine: 'EDGE_TTS', voice: 'th-TH-NiwatNeural', sound: 'ball_megu' } };
assert.deepStrictEqual([...getLocalDraftToolIds(audioDraft)], ['audioqueue'], 'a spoken-message draft must be guarded');
assert.equal(audioDraft.audioqueue.text, 'Keep this message', 'ordinary tool navigation must leave the parent-owned draft intact');

const confirmed = { ...audioDraft, audioqueue: { ...audioDraft.audioqueue, _submitted: true } };
assert.deepStrictEqual([...getLocalDraftToolIds(confirmed)], [], 'a server-confirmed submission must stop warning that the same content is unsent');

const allDrafts = {
	reactionroles: { messageIdInput: '123', emoji: '✅' },
	audioqueue: { senderName: 'Moderator' },
	embeds: { fields: [{ name: 'Rules', value: 'Be kind', inline: false }] },
};
assert.deepStrictEqual([...getLocalDraftToolIds(allDrafts)], ['reactionroles', 'audioqueue', 'embeds'], 'each independent editor must identify its own recovery scope');

const reset = emptyServerToolDrafts();
assert.notStrictEqual(reset, empty, 'guild changes must receive a fresh draft container');
assert.deepStrictEqual([...getLocalDraftToolIds(reset)], [], 'discarding or changing guilds must clear local draft warnings');

console.log('server dashboard drafts: independent editors preserve and identify recoverable work');
