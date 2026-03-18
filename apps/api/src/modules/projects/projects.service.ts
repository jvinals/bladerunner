import { Injectable } from '@nestjs/common';

const MOCK_PROJECTS = [
  {
    id: 'proj_edgehealth_portal',
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

  findAll() {
    return this.projects;
  }

  findOne(id: string) {
    return this.projects.find((p) => p.id === id) || null;
  }
}
