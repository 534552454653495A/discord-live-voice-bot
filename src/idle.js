// Cost control: GPT-Live is billed per second of session time, and the bot holds a
// session open while it sits in the channel. This governor tracks whether anyone has
// actually spoken recently and tells the bot when to close the session.
//
// The clock is injectable so this is unit-testable without waiting for real time.

export class IdleGovernor {
	constructor({ idleMs, now = Date.now }) {
		this.idleMs = idleMs;
		this.now = now;
		this.lastActivity = now();
	}

	/** Called whenever someone starts speaking. */
	touch() {
		this.lastActivity = this.now();
	}

	/** True when a session is open but nothing has been said for `idleMs`. */
	shouldPause(hasSession) {
		if (!hasSession || !(this.idleMs > 0)) return false;
		return this.now() - this.lastActivity >= this.idleMs;
	}
}
