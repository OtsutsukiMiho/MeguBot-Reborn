const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const database = require('../../backend/database/database.js');
const { LOCALES, localeChoices } = require('../../core/locales.js');
const { SERVER_LANG_KEY, serverLang, normalizeServerLang } = require('../../core/server-lang.js');
const event = require('./event.js');

// `/megu-language` sets the language Megu posts in for this server: bill
// cards, the due-day summary, the summary posted from the web and the link
// preview of a bill. The same setting as the dashboard's Language tab.
//
// Private replies are not this setting. Those follow each person's own choice
// on their account page, because a card is read by the group and a reply by
// one person.

const AUTO = 'auto';

// What each language is called, by a reader of each language. The choice list
// uses each language's own name for itself.
const NAMES = {
	th: { th: 'ภาษาไทย', en: 'ภาษาอังกฤษ' },
	en: { th: 'Thai', en: 'English' },
};

const COPY = {
	th: {
		guildOnly: 'ใช้คำสั่งนี้ในเซิร์ฟเวอร์นะ',
		set: name => `ต่อจากนี้ Megu จะโพสต์บิลในเซิร์ฟเวอร์นี้เป็น${name} รวมถึงการ์ดบิล สรุปวันครบกำหนด และตัวอย่างลิงก์`,
		auto: name => `Megu จะใช้ภาษาตามที่ตั้งไว้ในเซิร์ฟเวอร์ Discord ตอนนี้คือ${name}`,
		failed: 'บันทึกภาษาไม่สำเร็จ ลองใหม่อีกครั้งนะ',
		personal: 'ข้อความส่วนตัวที่ Megu ตอบแต่ละคนจะใช้ภาษาที่คนนั้นเลือกไว้ในหน้าบัญชี',
	},
	en: {
		guildOnly: 'Use this command in a server.',
		set: name => `From now on Megu posts bills in this server in ${name}, including bill cards, the due-day summary and link previews.`,
		auto: name => `Megu follows the language set for this Discord server, which is currently ${name}.`,
		failed: 'The language could not be saved. Please try again.',
		personal: 'Private replies to each person use the language they chose on their account page.',
	},
};

function nameOf(code, reader = code) {
	return NAMES[reader]?.[code] || LOCALES[code]?.label || code;
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('megu-language')
		.setNameLocalizations({ th: 'ภาษาเมกุ' })
		.setDescription('Choose the language Megu posts bills in for this server')
		.setDescriptionLocalizations({ th: 'เลือกภาษาที่ Megu ใช้โพสต์บิลในเซิร์ฟเวอร์นี้' })
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
		.setDMPermission(false)
		.addStringOption(option => option
			.setName('language')
			.setNameLocalizations({ th: 'ภาษา' })
			.setDescription('The language for bill cards and summaries')
			.setDescriptionLocalizations({ th: 'ภาษาของการ์ดบิลและสรุป' })
			.setRequired(true)
			.addChoices(
				...localeChoices().map(({ code }) => ({ name: nameOf(code), value: code })),
				{ name: 'Follow the Discord server language', name_localizations: { th: 'ตามภาษาของเซิร์ฟเวอร์ Discord' }, value: AUTO },
			)),

	async execute(interaction) {
		const reader = event.copyFor(interaction).lang;
		const t = COPY[reader] || COPY.en;
		if (!interaction.guildId) return interaction.reply({ content: t.guildOnly, flags: MessageFlags.Ephemeral });

		let code;
		try {
			code = normalizeServerLang(interaction.options.getString('language', true));
			if (code) await database.setGuildVar(interaction.guildId, SERVER_LANG_KEY, code);
			else await database.deleteGuildVar(interaction.guildId, SERVER_LANG_KEY);
		}
		catch (error) {
			console.warn(`[Megu] Could not save the language of ${interaction.guildId}: ${error.message}`);
			return interaction.reply({ content: t.failed, flags: MessageFlags.Ephemeral });
		}

		const line = code
			? t.set(nameOf(code, reader))
			: t.auto(nameOf(serverLang({ preferredLocale: interaction.guild?.preferredLocale || interaction.guildLocale }), reader));
		return interaction.reply({ content: `${line}\n${t.personal}`, flags: MessageFlags.Ephemeral });
	},
};
