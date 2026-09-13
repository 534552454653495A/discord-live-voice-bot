// Strings for src/tools/expressions.js (tr). Referenced as "tools.expressions.<key>".
export default {
	// listing
	list_emojis: 'Sunucuda {count} özel emoji var: {names}.',
	list_no_emojis: 'Sunucuda hiç özel emoji yok.',
	list_stickers: 'Sunucuda {count} çıkartma var: {names}.',
	list_no_stickers: 'Sunucuda hiç çıkartma yok.',
	list_more: '{names} ve {count} tane daha',
	list_failed: 'Emojileri ve çıkartmaları okuyamadım',

	// targets
	emoji_not_found: '"{name}" diye bir emoji bulamadım.',
	sticker_not_found: '"{name}" diye bir çıkartma bulamadım.',
	emoji_exists: '{name} adında bir emoji zaten var; başka bir isim seç.',
	sticker_exists: '{name} adında bir çıkartma zaten var; başka bir isim seç.',
	emoji_managed: '{name} bir entegrasyona ait, Discord onu yeniden adlandırmama da silmeme de izin vermiyor.',
	same_name: '{name} zaten öyle adlanıyor.',
	nothing_to_change: '{name} çıkartmasında neyi değiştireceğimi söylemedin.',

	// names
	emoji_name_invalid: 'Emoji adı 2 ile 32 arası harf, rakam veya alt çizgi olmalı; "{name}" olmuyor.',
	sticker_name_invalid: 'Çıkartma adı 2 ile 30 arası karakter olmalı; "{name}" olmuyor.',
	description_too_short: 'Çıkartma açıklaması en az 2 karakter olmalı, ya da hiç yazılmamalı.',

	// the picture
	no_image: 'Bunun için bir resim lazım. Resmi bir kanala at, bana o linki ver.',
	bad_url: '"{url}" adresini bir link olarak okuyamadım.',
	not_discord_url: 'Resimleri sadece Discord üzerinden indiriyorum. Resmi bir kanala at ve bana o linki ver.',
	download_unreadable: 'İndirdiğim şey kullanabileceğim bir resim değildi.',
	download_failed: 'Resmi indiremedim',
	image_too_large: 'Bu resim {size} KB, buradaki sınır ise {limit} KB; Discord kabul etmez.',
	sticker_format: 'Çıkartma PNG ya da GIF olmalı, bu dosya ise {type}.',

	// permissions
	need_create: 'Emoji ve çıkartma ekleyebilmem için "İfade Oluştur" yetkisi lazım.',
	need_manage: 'Başkasının eklediği bir emojiyi ya da çıkartmayı değiştirip silebilmem için "İfadeleri Yönet" yetkisi lazım.',

	// limits Discord names when it refuses
	limit_emoji_count: 'Sunucuda boş emoji yeri kalmamış',
	limit_animated_emoji_count: 'Sunucuda boş hareketli emoji yeri kalmamış',
	limit_sticker_count: 'Sunucuda boş çıkartma yeri kalmamış',
	limit_file_size: 'Bu dosya Discord’un izin verdiği boyutu aşıyor',
	limit_invalid_file: 'Discord bu dosyayı kabul etmedi',
	limit_resize: 'Discord bu resmi 256 KB’lik emoji sınırının altına indiremedi',
	sticker_rejected: 'Discord çıkartmayı kabul etmedi; 320 x 320 boyutunda, 512 KB’ın altında bir PNG ya da GIF olmalı',

	// results
	emoji_created: '{name} emojisini ekledim.',
	emoji_renamed: '{old} emojisinin adı artık {name}.',
	emoji_delete_question: '{name} emojisini sileceğim; onu kullanan bütün mesajlar resmi kaybeder ve bu geri alınamaz.',
	emoji_deleted: '{name} emojisini sildim.',
	sticker_created: '{name} çıkartmasını ekledim.',
	sticker_updated: '{old} çıkartmasını güncelledim: {details}.',
	sticker_delete_question: '{name} çıkartmasını sileceğim; bu geri alınamaz.',
	sticker_deleted: '{name} çıkartmasını sildim.',
	part_renamed: 'adı {name} oldu',
	part_description: 'açıklaması değişti',
	part_description_cleared: 'açıklaması silindi',
	part_tags: 'etiketi artık {tags}',

	// failures
	create_emoji_failed: 'Emojiyi ekleyemedim',
	rename_emoji_failed: 'Emojinin adını değiştiremedim',
	delete_emoji_failed: 'Emojiyi silemedim',
	create_sticker_failed: 'Çıkartmayı ekleyemedim',
	rename_sticker_failed: 'Çıkartmayı güncelleyemedim',
	delete_sticker_failed: 'Çıkartmayı silemedim',

	// logs
	log_emoji_created: '[araç] emoji eklendi: {name}',
	log_emoji_renamed: '[araç] emoji adı değişti: {old} -> {name}',
	log_emoji_deleted: '[araç] emoji silindi: {name}',
	log_sticker_created: '[araç] çıkartma eklendi: {name}',
	log_sticker_updated: '[araç] çıkartma güncellendi: {old} ({details})',
	log_sticker_deleted: '[araç] çıkartma silindi: {name}',
};
