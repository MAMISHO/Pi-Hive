const mockExtensionFactory = jest.fn((options: any) => ({ name: 'mcp', builtin: true, ...options }));
jest.mock('@earendil-works/pi-coding-agent', () => ({
  createMcpExtension: (options: any) => mockExtensionFactory(options),
  createCodemodeExtension: () => ({ name: 'codemode', builtin: true }),
  createToolSearchExtension: () => ({ name: 'tool-search', builtin: true }),
}), { virtual: true });

import { NexoPalaceMemoryService } from './nexo-palace-memory.service.js';

describe('NexoPalaceMemoryService', () => {
  let service: NexoPalaceMemoryService;
  let piConfig: any;
  const settings = {
    resolvePiAgentDir: jest.fn(),
    getMemoryGlobalEnabled: jest.fn(),
  };

  beforeEach(async () => {
    settings.resolvePiAgentDir.mockResolvedValue('/tmp/pi-agent');
    settings.getMemoryGlobalEnabled.mockResolvedValue(true);
    service = new NexoPalaceMemoryService(settings as any);
    piConfig = { servers: [], errors: [] };
    (service as any).getPiMcpConfigLoader = async () => () => piConfig;
    mockExtensionFactory.mockClear();
  });

  async function writePiConfig(servers: Record<string, any>) {
    piConfig.servers = Object.entries(servers).map(([name, config]) => ({
      name,
      config,
      source: '/tmp/pi-agent/mcp.json',
      scope: 'global',
    }));
  }

  it('detects enabled memory MCP from Pi config without returning connection details', async () => {
    await writePiConfig({ 'nexo-palace': { command: 'npx', args: ['secret-arg'], enabled: true } });
    const status = await service.getSanitizedStatus();
    expect(status.configured).toBe(true);
    expect(status.config.serverName).toBe('nexo-palace');
    expect(JSON.stringify(status)).not.toContain('secret-arg');
    expect(status.health.message).toContain('conexión pendiente');
  });

  it('ignores disabled memory servers and unrelated MCP servers', async () => {
    await writePiConfig({
      'nexo-palace': { command: 'npx', enabled: false },
      docs: { command: 'node', args: ['docs-server'] },
    });
    const status = await service.getSanitizedStatus();
    expect(status.configured).toBe(false);
  });

  it('filters only the memory MCP from a session when its preference is off', async () => {
    await writePiConfig({
      'nexo-palace': { command: 'npx' },
      docs: { command: 'node', args: ['docs-server'] },
    });
    const options = await service.resourceLoaderOptions(false);
    expect(options.extensionFactories.map((factory: any) => factory.name)).toEqual(['codemode', 'tool-search', 'mcp']);
    const ctx = { cwd: '/tmp/workspace', isProjectTrusted: () => false };
    const config = (options.extensionFactories[2] as any).loadConfig(ctx);
    expect(config.servers.map((server: any) => server.name)).toEqual(['docs']);
  });

  it('keeps Pi MCP servers in a session when memory is enabled', async () => {
    await writePiConfig({ 'nexo-palace': { command: 'npx' }, docs: { command: 'node' } });
    const options = await service.resourceLoaderOptions(true);
    const config = (options.extensionFactories[2] as any).loadConfig({ cwd: '/tmp/workspace', isProjectTrusted: () => false });
    expect(config.servers.map((server: any) => server.name)).toEqual(['nexo-palace', 'docs']);
    const memoryEntry = config.servers.find((server: any) => server.name === 'nexo-palace');
    expect(memoryEntry.config.exposure).toBe('direct');
    expect(memoryEntry.config.toolExposure).toEqual({ '*': 'hidden', memory_query: 'direct', memory_trace: 'direct' });
  });

  it('propagates Pi session availability without changing the global preference', async () => {
    await writePiConfig({ 'nexo-palace': { command: 'npx' } });
    await service.getSanitizedStatus(); // establishes the current Pi server identity before a session report
    expect(service.recordPiSessionMemoryTools([]).available).toBe(false);
    const unavailableStatus = await service.getSanitizedStatus();
    expect(unavailableStatus.available).toBe(false);
    expect(unavailableStatus.globalEnabled).toBe(true);
    expect(service.recordPiSessionMemoryTools(['mcp__nexo_palace__memory_query']).available).toBe(true);
    expect((await service.getSanitizedStatus()).available).toBe(true);
  });
});
