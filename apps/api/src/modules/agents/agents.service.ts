import { Injectable } from '@nestjs/common';

const MOCK_AGENTS = [
  {
    id: 'agent_browser_01',
    workspaceId: 'ws_careexpand',
    name: 'Browser Agent — Chrome',
    type: 'browser',
    status: 'online',
    version: '1.2.0',
    lastHeartbeatAt: '2026-03-18T14:59:00Z',
    capabilities: ['screenshot', 'interaction', 'visual_diff', 'performance_trace'],
    currentRunId: 'run_04LT0N5P6Q7S8X9Y',
    metadata: { chromeVersion: '122.0.6261.94', headless: true },
    createdAt: '2026-02-01T10:00:00Z',
  },
  {
    id: 'agent_mobile_01',
    workspaceId: 'ws_careexpand',
    name: 'Mobile Agent — iOS Simulator',
    type: 'mobile',
    status: 'online',
    version: '1.1.0',
    lastHeartbeatAt: '2026-03-18T14:58:30Z',
    capabilities: ['screenshot', 'interaction', 'gesture_replay', 'accessibility_audit'],
    currentRunId: undefined,
    metadata: { simulator: 'iPhone 15 Pro', iosVersion: '18.0' },
    createdAt: '2026-02-15T10:00:00Z',
  },
  {
    id: 'agent_desktop_01',
    workspaceId: 'ws_careexpand',
    name: 'Desktop Agent — macOS',
    type: 'desktop',
    status: 'busy',
    version: '1.0.5',
    lastHeartbeatAt: '2026-03-18T14:57:00Z',
    capabilities: ['screenshot', 'interaction', 'visual_diff', 'process_monitor'],
    currentRunId: 'run_01HQ7K2M3N4P5R6S',
    metadata: { os: 'macOS 14.3', display: '2560x1440' },
    createdAt: '2026-01-20T10:00:00Z',
  },
];

@Injectable()
export class AgentsService {
  private agents = [...MOCK_AGENTS];

  findAll() {
    return this.agents;
  }

  findOne(id: string) {
    return this.agents.find((a) => a.id === id) || null;
  }
}
