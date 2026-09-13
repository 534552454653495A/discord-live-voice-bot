import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeLiveError, LiveSession } from '../../src/live.js';

function fakeSession(executor) {
	const session = new LiveSession({ apiKey: 'x', delegationModel: 'm', toolExecutor: executor });
	const sent = [];
	session.ws = { send: (payload) => sent.push(payload), socket: { readyState: 1 } };
	session.ready = true;
	return { session, sent };
}

describe('LiveSession tool loop', () => {
	it('drops the pending calls of a failed response and emits a warning that names the reason', async () => {
		const { session, sent } = fakeSession(async () => 'x');
		const warnings = [];
		session.on('warning', (m) => warnings.push(m));
		session._onResponseEvent({ event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c1', name: 'send_message', arguments: '{}' } } });
		session._onResponseEvent({ event: { type: 'response.failed', response: { error: { message: 'quota exhausted' } } } });
		assert.equal(session._pendingCalls.length, 0);
		assert.ok(warnings[0].includes('quota exhausted'), warnings[0]);
		assert.ok(warnings[0].includes('did not complete'), 'the warning wording comes from the English bundle');
		assert.equal(sent.length, 0);
	});

	it('does not run a tool whose arguments are invalid JSON, and reports the error to the model', async () => {
		const calls = [];
		const { session, sent } = fakeSession(async (name, args) => (calls.push([name, args]), 'ok'));
		session._onResponseEvent({ event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c1', name: 'ban_member', arguments: '{broken' } } });
		session._onResponseEvent({ event: { type: 'response.completed' } });
		await session._flushing;
		assert.equal(calls.length, 0, 'the tool must not be called');
		assert.equal(sent[0].type, 'response.item.create');
		assert.ok(JSON.parse(sent[0].item.output).error.includes('invalid JSON'), sent[0].item.output);
		assert.equal(sent[1].type, 'response.create');
	});

	it('emits a send failure as an error event instead of crashing the process', async () => {
		const { session } = fakeSession(async () => 'ok');
		session.ws.send = () => {
			throw new Error('socket closed');
		};
		const errors = [];
		session.on('error', (e) => errors.push(e.message));
		session._onResponseEvent({ event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c1', name: 'x', arguments: '{}' } } });
		session._onResponseEvent({ event: { type: 'response.completed' } });
		await session._flushing;
		assert.ok(errors.some((m) => m.includes('socket closed')));
	});

	it('serialises concurrent flushes: two completed events produce one queue, not two response.create calls', async () => {
		let resolveTool;
		const { session, sent } = fakeSession(() => new Promise((r) => (resolveTool = r)));
		session._onResponseEvent({ event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c1', name: 'x', arguments: '{}' } } });
		session._onResponseEvent({ event: { type: 'response.completed' } });
		session._onResponseEvent({ event: { type: 'response.completed' } });
		await new Promise((r) => setImmediate(r));
		resolveTool('ok');
		await session._flushing;
		assert.equal(sent.filter((p) => p.type === 'response.create').length, 1);
	});
});

describe('describeLiveError', () => {
	it('treats a billing wall as permanent even when it arrives with no code', () => {
		// Seen in the wild as a plain invalid_request_error whose only clue is the sentence. Without this the
		// socket stays open, every request on it fails, and the assistant keeps saying it did the work.
		const verdict = describeLiveError({
			error: { type: 'invalid_request_error', message: 'You have no credits remaining. Add credits to continue using the API.' },
		});
		assert.equal(verdict.fatal, true);
		assert.ok(verdict.hint, 'the owner is told what to do about it');
		assert.equal(describeLiveError({ error: { type: 'server_error', message: 'upstream timeout' } }).fatal, false);
	});
});
