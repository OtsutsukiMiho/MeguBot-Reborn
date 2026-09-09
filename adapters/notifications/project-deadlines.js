const core = require('../../core/index.js');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

function createProjectDeadlineSweep({ baseUrl = '', log = () => undefined } = {}) {
	let running = false;
	async function runOnce({ now = new Date() } = {}) {
		if (running) return { queued: 0, skipped: 0, jobs: 0, alreadyRunning: true };
		running = true;
		try {
			const result = await core.projectReminders.queueDue({ now, baseUrl });
			if (result.queued || result.skipped) log(`Project deadlines: ${result.queued} queued, ${result.skipped} skipped as obsolete`);
			return result;
		}
		finally { running = false; }
	}
	function start({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
		const tick = () => runOnce().catch(error => log(`Project deadline sweep failed: ${error.message}`));
		const timer = setInterval(tick, intervalMs);
		const kickoff = setTimeout(tick, 60 * 1000);
		timer.unref?.();
		kickoff.unref?.();
		return () => { clearInterval(timer); clearTimeout(kickoff); };
	}
	return { runOnce, start };
}

module.exports = { createProjectDeadlineSweep, DEFAULT_INTERVAL_MS };
