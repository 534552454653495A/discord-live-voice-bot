// Strings for src/tools/moderation.js (tr). Referenced as "tools.moderation.<key>".
export default {
	fuzzy_question: '"{name}" adını tam eşleştiremedim; en yakın kişi {who}. {action} bu kişiye mi?',
	action_timeout: 'Timeout',
	action_kick: 'Sunucudan atma',
	action_ban: 'Ban',

	member_not_found: '"{name}" diye birini bulamadım.',
	that_person: 'O kişi',

	no_timeout_permission: '{who} üzerinde yetkim yetmiyor (rol sırası).',
	log_timeout: '[araç] timeout: {who} ({minutes} dk)',
	timeout_done: '{who} kişisine {minutes} dakika timeout verdim.',
	timeout_failed: 'Timeout uygulayamadım',

	log_untimeout: '[araç] susturma kaldırıldı: {who}',
	untimeout_done: '{who} kişisinin susturmasını kaldırdım.',
	untimeout_failed: 'Susturmayı kaldıramadım',

	no_kick_permission: '{who} üzerinde kick yetkim yetmiyor (rol sırası).',
	log_kick: '[araç] kick: {who}',
	kick_done: '{who} kişisini sunucudan attım.',
	kick_failed: 'Kişiyi atamadım',

	no_ban_permission: '{who} üzerinde ban yetkim yetmiyor.',
	log_ban: '[araç] ban: {who}',
	ban_done: '{who} kişisini banladım.',
	ban_failed: 'Banlayamadım',

	log_ban_list: '[araç] ban listesi: {count} kişi',
	ban_list: 'Ban listesinde {count} kişi var: {names}{more}.',
	ban_list_empty: 'Ban listesi boş.',
	ban_list_failed: 'Ban listesini göremedim',

	no_unban_target: 'Kimin banını kaldıracağımı anlayamadım.',
	unban_not_found: 'Ban listesinde "{name}" diye birini bulamadım.',
	log_unban: '[araç] ban kaldırıldı: {who}',
	unban_done: '{who} kişisinin banını kaldırdım.',
	unban_failed: 'Banı kaldıramadım',

	log_audit: '[araç] denetim kaydı okundu: {count} kayıt',
	audit_summary: 'Son {count} yönetici işlemi — en yenisi: {executor} {action}{target}.',
	audit_empty: 'Denetim kaydı boş görünüyor.',
	audit_failed: 'Denetim kaydını göremedim',
};
