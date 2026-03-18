import { Injectable } from '@nestjs/common';

const MOCK_PROJECTS = [
  {
    id: 'proj_edgehealth_portal',
    userId: 'user_2m19m7Zf6X4t5W8K9u0v1x2y3z4', // Default test user
    workspaceId: 'ws_edgehealth',
    name: 'Edgehealth Portal',
    description: 'Main patient and provider portal — desktop web application',
    repositoryUrl: 'https://github.com/edgehealth/portal',
    defaultBranch: 'main',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-03-18T10:00:00Z',
  },
  {
    id: 'proj_edgehealth_mobile',
    userId: 'user_2m19m7Zf6X4t5W8K9u0v1x2y3z4',
    workspaceId: 'ws_edgehealth',
    name: 'Edgehealth Mobile',
    description: 'Patient-facing mobile app and PWA',
    repositoryUrl: 'https://github.com/edgehealth/mobile',
    defaultBranch: 'main',
    createdAt: '2026-02-01T10:00:00Z',
    updatedAt: '2026-03-18T10:00:00Z',
  },
  {
    id: 'proj_edgehealth_admin',
    userId: 'other_user',
    workspaceId: 'ws_edgehealth',
    name: 'Edgehealth Admin',
    description: 'Internal admin panel for workspace and system management',
    repositoryUrl: 'https://github.com/edgehealth/admin',
    defaultBranch: 'develop',
    createdAt: '2026-02-20T10:00:00Z',
    updatedAt: '2026-03-15T10:00:00Z',
  },
];

@Injectable()
export class ProjectsService {
  private projects = [...MOCK_PROJECTS];

  findAll(userId: string) {
    return this.projects.filter((p) => p.userId === userId);
  }

  findOne(id: string, userId: string) {
    return this.projects.find((p) => p.id === id && p.userId === userId) || null;
  }
}
