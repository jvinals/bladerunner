import { Injectable } from '@nestjs/common';

const MOCK_INTEGRATIONS = [
  {
    id: 'int_github',
    userId: 'user_2m19m7Zf6X4t5W8K9u0v1x2y3z4', // Default test user
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
    userId: 'user_2m19m7Zf6X4t5W8K9u0v1x2y3z4',
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
    userId: 'other_user',
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
    userId: 'user_2m19m7Zf6X4t5W8K9u0v1x2y3z4',
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

  findAll(userId: string) {
    return this.integrations.filter((i) => (i as any).userId === userId);
  }

  findOne(id: string, userId: string) {
    return this.integrations.find((i) => i.id === id && (i as any).userId === userId) || null;
  }
}
