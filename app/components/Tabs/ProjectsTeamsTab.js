'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useCopy } from '../../copy';
import { TabSection, TabWorkspace } from './TabWorkspace';

export default function ProjectsTeamsTab({ guildId, serverName }) {
	const { t } = useCopy();
	const c = t.serverWorkspaces;
	return <TabWorkspace labelledBy="server-project-workspace-title">
		<TabSection id="server-project-workspace-title" title={t.teams.serverWorkspaceTitle} description={c.bridgeHint(serverName || t.teams.discordServer)}>
			<p>{c.privateHint}</p>
			<Link className="btn btn-primary" href={`/teams/server/${encodeURIComponent(guildId)}/teams`}>
				{c.openWorkspace}<ArrowRight size={16} aria-hidden="true" />
			</Link>
		</TabSection>
	</TabWorkspace>;
}
