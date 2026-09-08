'use strict';

function emptyServerToolDrafts() {
	return { reactionroles: {}, audioqueue: {}, embeds: {} };
}

function getLocalDraftToolIds(toolDrafts = {}) {
	const pending = new Set();
	const reactionDraft = toolDrafts.reactionroles || {};
	if (['messageIdInput', 'channelId', 'emoji', 'roleId'].some(key => String(reactionDraft[key] || '').trim())) pending.add('reactionroles');

	const audioDraft = toolDrafts.audioqueue || {};
	if (!audioDraft._submitted && (
		String(audioDraft.text || '').trim()
		|| String(audioDraft.senderName || '').trim()
		|| (audioDraft.sound && audioDraft.sound !== 'ball_megu')
		|| (audioDraft.engine && audioDraft.engine !== 'EDGE_TTS')
		|| (audioDraft.voice && audioDraft.voice !== 'th-TH-NiwatNeural')
	)) pending.add('audioqueue');

	const embedDraft = toolDrafts.embeds || {};
	if (!embedDraft._submitted && Object.entries(embedDraft).some(([key, value]) => {
		if (key === '_submitted') return false;
		if (key === 'fields') return Array.isArray(value) && value.some(field => field.name || field.value || field.inline);
		if (key === 'includeTimestamp') return value === true;
		return String(value || '').trim();
	})) pending.add('embeds');

	return pending;
}

module.exports = { emptyServerToolDrafts, getLocalDraftToolIds };
