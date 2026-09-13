'use strict';

const DISCORD_SNOWFLAKE = /^\d{17,20}$/;
const DEPLOYMENT_CONFIG_ERROR = 'COMMAND_DEPLOYMENT_CONFIG';

function deploymentConfigError(message) {
	const error = new Error(message);
	error.code = DEPLOYMENT_CONFIG_ERROR;
	return error;
}

function resolveDeploymentTarget({ args = process.argv.slice(2), env = process.env, routes, clientId }) {
	if (!routes || !clientId) throw deploymentConfigError('Discord command deployment requires Routes and a client ID.');
	if (args.length === 0) {
		return {
			kind: 'global',
			label: 'globally',
			route: routes.applicationCommands(clientId),
		};
	}
	if (args.length !== 1 || args[0] !== '--guild') {
		throw deploymentConfigError('Unknown command deployment arguments. Use no arguments for global deployment or --guild for the configured test guild.');
	}

	const guildId = String(env.MEGU_DISCORD_TEST_GUILD_ID || '').trim();
	if (!DISCORD_SNOWFLAKE.test(guildId)) {
		throw deploymentConfigError('Guild command deployment requires MEGU_DISCORD_TEST_GUILD_ID with a valid Discord guild ID.');
	}
	return {
		kind: 'guild',
		guildId,
		label: `to test guild ${guildId}`,
		route: routes.applicationGuildCommands(clientId, guildId),
	};
}

module.exports = { DEPLOYMENT_CONFIG_ERROR, DISCORD_SNOWFLAKE, resolveDeploymentTarget };
