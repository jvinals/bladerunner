import { Injectable } from '@nestjs/common';

const MOCK_INTEGRATIONS = [
  {
    id: 'int_github',
    workspaceId: 'ws_edgehealth',
    name: 'GitHub',
    type: 'github',
    status: 'active',
    config: { org: 'edgehealth', webhookEnabled: true },
    lastSyncAt: '2026-03-18T10:00:00Z',
    createdAt: '2026-01-15T10:00:00Z',
  },
  {
    id: 'int_slack',
    workspaceId: 'ws_careexpand',
    name: 'Slack',
    type: 'slack',
    status: 'active',
    config: { channel: '#bladerunner-alerts' },
    lastSyncAt: '2026-03-18T14:00:00Z',
    createdAt: '2026-02-01T10:00:00Z',
  },
  {
    id: 'int_orchestrator',
    workspaceId: 'ws_careexpand',
    name: 'Orchestrator',
    type: 'orchestrator',
    status: 'pending',
    config: {},
    lastSyncAt: undefined,
    createdAt: '2026-03-10T10:00:00Z',
  },
  {
    id: 'int_cicd',
    workspaceId: 'ws_careexpand',
    name: 'CI/CD Pipeline',
    type: 'ci_cd',
    status: 'active',
    config: { provider: 'GitHub Actions' },
    lastSyncAt: '2026-03-18T09:30:00Z',
    createdAt: '2026-01-20T10:00:00Z',
  },
];

@Injectable()
export class IntegrationsService {
  private integrations = [...MOCK_INTEGRATIONS];

  findAll() {
    return this.integrations;
  }

  findOne(id: string) {
    return this.integrations.find((i) => i.id === id) || null;
  }
}
