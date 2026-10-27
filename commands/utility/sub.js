const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const event = require('./event.js');

// `/sub`: a bill that comes back every month. The service name is asked in
// the modal, so the command itself takes nothing.
//
// The same modal and card as `/event`, and the same buttons, because a
// subscription is the same money problem on a timer: who shares it, what it
// costs, and who has paid this month. What differs lives in core — each month
// opens by copying the one before it, and the payment-due sweep DMs whoever
// has not paid on the day and posts one summary in this channel.
//
// Submissions and buttons come back through `/event`'s component router
// (custom ids beginning `evt:`), so there is exactly one place that writes to
// the ledger from Discord.

module.exports = {
	data: new SlashCommandBuilder()
		.setName('sub')
		.setDescription('Split a monthly subscription: who shares it, how much, which day')
		.setDescriptionLocalizations({ th: 'หารค่าบริการรายเดือน: ใครหารบ้าง เท่าไหร่ ครบกำหนดวันไหน' }),

	async execute(interaction) {
		const t = event.copyFor(interaction);
		if (!interaction.guildId) {
			return interaction.reply({ content: t.guildOnly.replace('/event', '/sub'), flags: MessageFlags.Ephemeral });
		}
		// The modal must be the first response, so nothing is looked up first.
		return interaction.showModal(event.subModal(t));
	},
};
