export function guildIconUrl(guild) {
	if (!guild?.icon) return null;
	if (guild.icon.startsWith('http')) return guild.icon;
	const extension = guild.icon.startsWith('a_') ? 'gif' : 'png';
	return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${extension}?size=128`;
}
