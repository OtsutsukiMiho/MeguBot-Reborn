// The bot spoke every TTS clip twice. Not two bot instances, and not the
// VoiceStateUpdate handler firing twice — audit_logs showed exactly one row per
// event throughout. It was the queue.
//
// AudioPlayer emits `stateChange` before it emits the named status event:
//
//     this.emit("stateChange", oldState, newState);
//     if (oldState.status !== newState.status) this.emit(newState.status, ...);
//
// (@discordjs/voice, AudioPlayer's state setter.) The queue had a listener on
// each. The stateChange one called processNext, and it ran first — while the
// clip that had just finished was still at queue[0]. So it played that same
// clip again, and only afterwards did the once('idle') handler shift it off.
//
// These tests hold the wiring that fixed it. No audio is produced: everything
// here is about which listener is allowed to advance the queue.
require('dotenv').config();
const assert = require('node:assert');
const { AudioQueueManager } = require('../backend/bot/audio_queue.js');

let n = 0;
function ok(msg) {
	n++;
	console.log(`  ok  ${msg}`);
}

function main() {
	// 1. Reaching idle through stateChange must not advance the queue.
	{
		const manager = new AudioQueueManager();
		let advanced = 0;
		manager.processNext = () => { advanced++; };

		const player = manager.getPlayer('guild-a');
		player.emit('stateChange', { status: 'playing' }, { status: 'idle' });

		assert.strictEqual(advanced, 0,
			'stateChange reaching idle must not start the next clip — idle does that, after the queue has moved on');
		ok('a clip finishing does not advance the queue twice');
	}

	// 2. The player's error listener logs and stops there. The player goes idle
	//    after an error, and that path already drops the clip; advancing here as
	//    well would skip whatever was queued behind it.
	{
		const manager = new AudioQueueManager();
		let advanced = 0;
		manager.processNext = () => { advanced++; };

		const player = manager.getPlayer('guild-b');
		player.emit('error', Object.assign(new Error('resource died'), { resource: null }));

		assert.strictEqual(advanced, 0, 'the error listener must not advance the queue on its own');
		ok('a player error does not skip the clip behind the one that failed');
	}

	// 3. A caller arriving while a clip is in flight is turned away, rather than
	//    reading the same queue[0] and playing it a second time.
	{
		const manager = new AudioQueueManager();
		const queue = manager.getQueue('guild-c');
		queue.push({ id: '1', text: 'ฟิก เข้าดิสมา', options: {}, guildName: 'g', connection: null });

		manager.busy.add('guild-c');
		manager.processNext('guild-c');

		assert.strictEqual(queue.length, 1, 'the queue must be untouched while a clip is in flight');
		ok('processNext refuses to start a second clip over a running one');
	}

	// 4. Clearing has to release the flag, or the guild is left marked busy for a
	//    clip that will never finish and nothing it queues afterwards ever plays.
	{
		const manager = new AudioQueueManager();
		manager.getQueue('guild-d').push({ id: '1', text: 'x', options: {}, guildName: 'g', connection: null });
		manager.busy.add('guild-d');

		manager.clearQueue('guild-d');

		assert.strictEqual(manager.busy.has('guild-d'), false, 'clearQueue must release the busy flag');
		assert.strictEqual(manager.getQueue('guild-d').length, 0, 'clearQueue must empty the queue');
		ok('clearing a queue does not leave the guild permanently mute');
	}

	// 5. Only one listener may advance the queue. If a future change adds a
	//    second one on the player itself, this is where it gets noticed.
	{
		const manager = new AudioQueueManager();
		const player = manager.getPlayer('guild-e');
		assert.strictEqual(player.listenerCount('stateChange'), 0,
			'nothing should be listening on stateChange — advancing belongs to idle alone');
		ok('the player carries no stateChange listener at all');
	}
}

try {
	main();
	console.log(`\n  ${n} checks passed`);
}
catch (error) {
	console.error(`\n  FAILED  ${error.message}`);
	process.exitCode = 1;
}
