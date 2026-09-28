'use strict';

function parseDirectoryFilters(search, teamsEnabled = true) {
	const params = new URLSearchParams(search);
	return {
		query: (params.get('q') || '').slice(0, 120),
		bucket: params.get('bucket') === 'closed' ? 'closed' : 'active',
		mine: params.get('assigned') === 'true',
		scope: teamsEnabled ? (params.get('team') || 'all').slice(0, 200) : 'all',
		server: teamsEnabled && /^\d{17,20}$/.test(params.get('server') || '') ? params.get('server') : '',
		cursor: (params.get('cursor') || '').slice(0, 500),
	};
}

function serializeDirectoryFilters({ query, bucket, mine, scope, server, cursor }) {
	const params = new URLSearchParams();
	if (query) params.set('q', query.slice(0, 120));
	if (bucket === 'closed') params.set('bucket', 'closed');
	if (mine) params.set('assigned', 'true');
	if (scope && scope !== 'all') params.set('team', scope);
	if (server) params.set('server', server);
	if (cursor) params.set('cursor', cursor.slice(0, 500));
	return params.toString();
}

module.exports = { parseDirectoryFilters, serializeDirectoryFilters };
