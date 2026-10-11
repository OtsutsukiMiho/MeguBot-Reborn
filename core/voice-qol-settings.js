'use strict';

const DEFAULT_BATCH_WINDOW_MS = 1500;
const MIN_BATCH_WINDOW_MS = 500;
const MAX_BATCH_WINDOW_MS = 5000;
const MAX_TEMPLATE_LENGTH = 300;
const MEMBER_FIELDS = ['displayname', 'nickname', 'username', 'tag'];
const ANNOUNCEMENT_FIELDS = [...MEMBER_FIELDS, 'server'];
const TEXT_TTS_FIELDS = [...ANNOUNCEMENT_FIELDS, 'message'];

// Voice templates historically use case-insensitive {field} tokens and do not
// support escaped braces. Empty/null means reset, never a silent announcement.
function validVoiceTemplate(value, kind) {
	if (value === null || value === '') return true;
	if (typeof value !== 'string' || value.length > MAX_TEMPLATE_LENGTH
		|| /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)
		|| /\\(?:[{}]|u[\da-f]{4}|x[\da-f]{2}|[0bfnrtv])/i.test(value)) return false;
	const fields = kind === 'text' ? TEXT_TTS_FIELDS : ANNOUNCEMENT_FIELDS;
	const found = [];
	const rest = value.replace(/{([^{}]+)}/g, (_, field) => {
		found.push(field.toLowerCase());
		return '';
	});
	if (/[{}]/.test(rest) || found.some(field => !fields.includes(field))) return false;
	return kind === 'text' ? found.includes('message') : found.some(field => MEMBER_FIELDS.includes(field));
}
function waitingRoomTemplate(value, lang) {
	return value && validVoiceTemplate(value, 'waiting') ? value
		: String(lang).toLowerCase().startsWith('en') ? '{nickname} joined the waiting room' : '{nickname} เข้าห้องรอแล้ว';
}
function textTtsTemplate(value) {
	return value && validVoiceTemplate(value, 'text') ? value : '{message}';
}

function validBatchWindow(value) {
	return typeof value === 'number' && Number.isInteger(value)
		&& value >= MIN_BATCH_WINDOW_MS && value <= MAX_BATCH_WINDOW_MS;
}
function resolveBatchWindow(value) {
	return validBatchWindow(value) ? value : DEFAULT_BATCH_WINDOW_MS;
}
function batchWindowFromSeconds(value) {
	if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return '';
	const ms = Number(value) * 1000;
	return Number.isFinite(ms) ? Math.round(ms) : '';
}

module.exports = { DEFAULT_BATCH_WINDOW_MS, MIN_BATCH_WINDOW_MS, MAX_BATCH_WINDOW_MS,
	validBatchWindow, resolveBatchWindow, batchWindowFromSeconds, MAX_TEMPLATE_LENGTH,
	ANNOUNCEMENT_FIELDS, TEXT_TTS_FIELDS, validVoiceTemplate, waitingRoomTemplate, textTtsTemplate };
