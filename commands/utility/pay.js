const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const core = require('../../core/index.js');
const { submitDiscordSlip, money } = require('../../adapters/discord/slip-submit.js');

// `/pay` (`/จ่าย` for anyone whose Discord is in Thai): a slip and an amount,
// checked and recorded by Megu. Used inside a bill's thread it already knows
// which bill is meant, so the bill option is only needed elsewhere.

const T = {
	th: {
		guildOnly: 'ใช้คำสั่งนี้ในเซิร์ฟเวอร์ที่รายการถูกสร้างไว้นะ',
		none: 'ไม่พบยอดค้างที่ผูกกับ Discord ของคุณ ลองเข้าเว็บแล้วกดชื่อตัวเองก่อน',
		many: choices => `มีหลายรายการ เลือกช่อง **รายการ** แล้วลองอีกครั้งนะ\n${choices}`,
	},
	en: {
		guildOnly: 'Use this in the server where the bill was made.',
		none: 'Nothing unpaid is linked to your Discord. Open the bill on the web and pick your name first.',
		many: choices => `You are on more than one bill. Pick one in the **bill** option and try again.\n${choices}`,
	},
};

const copyFor = interaction => T[String(interaction.locale || '').startsWith('th') ? 'th' : 'en'];

async function candidates(interaction, search = '') {
	return core.activities.listPaymentCandidatesForDiscord(
		interaction.user.id,
		interaction.guildId,
		search,
	);
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('pay')
		.setNameLocalizations({ th: 'จ่าย' })
		.setDescription('Send a slip for Megu to check and record')
		.setDescriptionLocalizations({ th: 'แจ้งชำระเงินพร้อมสลิปให้ Megu ตรวจและบันทึก' })
		.addNumberOption(option => option
			.setName('amount')
			.setNameLocalizations({ th: 'จำนวน' })
			.setDescription('How much you transferred')
			.setDescriptionLocalizations({ th: 'จำนวนเงินที่โอน' })
			.setMinValue(0.01)
			.setRequired(true))
		.addAttachmentOption(option => option
			.setName('slip')
			.setNameLocalizations({ th: 'สลิป' })
			.setDescription('The bank slip; without one it does not count as paid')
			.setDescriptionLocalizations({ th: 'ภาพสลิปธนาคาร ไม่มีสลิปจะยังไม่นับว่าจ่าย' })
			.setRequired(true))
		.addStringOption(option => option
			.setName('bill')
			.setNameLocalizations({ th: 'รายการ' })
			.setDescription('Bill name or code (not needed inside a bill thread or with one bill)')
			.setDescriptionLocalizations({ th: 'ชื่อบิลหรือรหัส (ไม่ต้องใส่ถ้าพิมพ์ในเธรดบิล หรือมีบิลเดียว)' })
			.setAutocomplete(true)),

	async autocomplete(interaction) {
		const focused = interaction.options.getFocused() || '';
		const found = await candidates(interaction, focused);
		await interaction.respond(found.slice(0, 25).map(item => ({
			name: `${item.title} ${money(item.outstandingSatang)} (${item.code})`.slice(0, 100),
			value: item.code,
		}))).catch(() => undefined);
	},

	async execute(interaction) {
		const t = copyFor(interaction);
		if (!interaction.guildId) {
			return interaction.reply({ content: t.guildOnly, flags: MessageFlags.Ephemeral });
		}
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// Inside a bill's own thread, that bill is the one meant.
		const search = interaction.options.getString('bill')
			|| (interaction.channel?.isThread?.() ? await core.activities.getActivityCodeByChannel(interaction.channelId) : null)
			|| '';
		const found = await candidates(interaction, search);
		if (found.length === 0) return interaction.editReply(t.none);
		if (found.length > 1) {
			const choices = found.slice(0, 8).map(item => `- **${item.title}** ${money(item.outstandingSatang)} (${item.code})`).join('\n');
			return interaction.editReply(t.many(choices));
		}
		const candidate = found[0];
		const reply = await submitDiscordSlip({
			candidate,
			amountSatang: Math.round(interaction.options.getNumber('amount', true) * 100),
			attachment: interaction.options.getAttachment('slip', true),
			senderDiscordUid: interaction.user.id,
			lang: t === T.th ? 'th' : 'en',
			notifyOwner: async (uid, message) => {
				const owner = await interaction.client.users.fetch(uid);
				await owner.send({ ...message, allowedMentions: { parse: [] } });
			},
		});
		await interaction.editReply(reply);
	},
};
