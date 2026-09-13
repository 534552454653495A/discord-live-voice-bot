// Strings for src/agent.js (tr). Referenced as "agent.<key>".
export default {
	done: 'Tamam.',
	research_unavailable: 'Araştırma backend ayarlı değil (.env içine RESEARCH_MODEL ya da DEEPSEEK_API_KEY ekle).',
	research_prompt: 'Kullanıcı bir Discord sesli kanalında şunu söyledi (döküm hatalı olabilir): {question}. ',
	research_with_search: 'Gerekirse web araması yap. ',
	research_without_search: 'Web araması yapamıyorsun; yalnızca bildiğin kadarıyla cevap ver, arama yapmış gibi davranma. ',
	research_style: 'Yanıt sesli okunacak: en fazla 3 cümle, Türkçe ve doğal olsun. ',
	research_honesty: 'Emin olmadığın bir şeyi uydurma; bilmiyorsan bilmediğini söyle.',
	research_empty: 'Araştırmadan sonuç çıkmadı.',
	empty_result: 'Sonuç çıkmadı.',
	log_research_failed: 'Araştırma hatası: {error}',
	research_failed: 'Araştırma yapamadım; birazdan tekrar dener misin?',
	request_unclear: 'İsteği tam anlayamadım, tekrar söyler misin?',
	intent_unclear: 'Ne yapmamı istediğini anlayamadım.',
};
