// Strings for src/agent.js (en). Referenced as "agent.<key>".
export default {
	done: 'All right.',
	research_unavailable: 'The research backend is not configured (add RESEARCH_MODEL or DEEPSEEK_API_KEY to .env).',
	research_prompt: 'A user in a Discord voice channel said this (the transcript may be wrong): {question}. ',
	research_with_search: 'Search the web if you need to. ',
	research_without_search: 'You cannot search the web; answer only from what you already know and do not act as if you had searched. ',
	research_style: 'The answer will be read out loud: at most 3 sentences, in English and natural. ',
	research_honesty: 'Do not make up anything you are not sure of; if you do not know, say that you do not know.',
	research_empty: 'The research did not turn anything up.',
	empty_result: 'Nothing came of it.',
	log_research_failed: 'Research error: {error}',
	research_failed: 'I could not do the research; could you try again in a moment?',
	request_unclear: 'I did not quite get the request, could you say it again?',
	intent_unclear: 'I could not work out what you want me to do.',
};
