// voice strings (en). Keys are referenced as "voice.<key>" through src/i18n.
export default {
	ring_capacity: 'Ring capacity must be a positive integer: {capacity}',
	speaking: 'speaking: {ids}',
	output_blocked: 'audio output is blocked; {count} frames dropped',
	connection_destroyed: 'the voice connection was destroyed',
	state_timeout: 'the voice connection never reached the {status} state (currently: {current})',
	join_cancelled: 'join cancelled (a newer request arrived)',
	join_retry: 'Could not establish the voice connection; leaving first and trying again...',
	state_change: 'voice state: {from} -> {to}',
	connection_error: 'voice connection error:',
	disconnected: 'The voice connection dropped (reason: {reason}{code}).',
	disconnect_code: ', code: {code}',
	player_error: 'playback error:',
	stream_error: 'audio stream error:',
	receive_error: 'audio receive error',
	opus_decode_error: 'opus decode error',
};
