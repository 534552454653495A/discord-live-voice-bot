// Tool definition helper: schema + gate + handler live in one object, so the answer to
// "which tool needs the owner" is not scattered across the code.

/**
 * @param {object} spec
 * @param {string} spec.name
 * @param {string} spec.description
 * @param {object} [spec.parameters] JSON schema (default: no parameters)
 * @param {{keywords?: string[]} | null} [spec.gate] owner gate; keywords = the words the owner must have said
 * @param {(args: object, deps: object, ctx: {name: string}) => Promise<object>} spec.handler
 */
export function defineTool({ name, description, parameters = { type: 'object', properties: {} }, gate = null, handler }) {
	if (!name || typeof handler !== 'function') throw new Error(`incomplete tool definition: ${name}`);
	return {
		name,
		gate,
		handler,
		definition: { type: 'function', name, description, parameters },
	};
}

/** Schema shorthands. */
export const P = {
	str: (description) => ({ type: 'string', description }),
	int: (description) => ({ type: 'integer', description }),
	num: (description) => ({ type: 'number', description }),
	bool: (description) => ({ type: 'boolean', description }),
	list: (description) => ({ type: 'array', items: { type: 'string' }, description }),
	obj: (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) }),
	confirm: () => ({
		type: 'boolean',
		description: 'Confirmation step: leave empty on the first call (it only asks), set to true once the owner confirms',
	}),
};
