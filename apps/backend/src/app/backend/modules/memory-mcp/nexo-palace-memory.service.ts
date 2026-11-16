import { Inject, Injectable, Optional } from '@nestjs/common';
import { createCodemodeExtension, createMcpExtension, createToolSearchExtension } from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppSettingsService } from '../app-settings/app-settings.service.js';
import { IWorkspaceRepository, IWorkspaceRepositoryToken } from '../workspace/domain/repositories/workspace-repository.interface.js';
import { IAgent } from '../agent/domain/models/agent.interface.js';
import { IWorkspace } from '../workspace/domain/models/workspace.interface.js';

const INSTALL_URL = 'https://github.com/JonyDevProjects/nexo-palace';
const MEMORY_SERVER_PATTERN = /nexo|palace|nxpl/i;
let loadPiMcpConfigPromise: Promise<(options: { agentDir: string; cwd: string; projectTrusted: boolean }) => any> | null = null;

function resolvePiMcpConfigModule(): string {
  // The SDK package exposes an ESM entry but blocks require.resolve(package); locate its
  // installed package directory without resolving the package root through the CJS export map.
  let directory = path.resolve(process.cwd());
  for (let depth = 0; depth < 10; depth++) {
    const modulePath = path.join(directory, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'extensions', 'mcp', 'config.js');
    if (existsSync(modulePath)) return pathToFileURL(modulePath).href;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error('No se encontró el cargador MCP instalado por la SDK de Pi.');
}

async function loadPiMcpConfigApi() {
  if (!loadPiMcpConfigPromise) {
    const configModule = resolvePiMcpConfigModule();
    loadPiMcpConfigPromise = import(configModule).then((mod: any) => mod.loadMcpConfig);
  }
  return loadPiMcpConfigPromise;
}

interface MemoryServer {
  name: string;
}

function isMemoryServer(entry: any): boolean {
  const config = entry?.config || {};
  const identity = [entry?.name, entry?.source, config.command, config.url, config.description, ...(Array.isArray(config.args) ? config.args : [])]
    .filter((value) => typeof value === 'string')
    .join(' ');
  return MEMORY_SERVER_PATTERN.test(identity);
}

@Injectable()
export class NexoPalaceMemoryService {
  private connectionState: 'unknown' | 'connected' | 'unavailable' = 'unknown';
  private connectionServerName: string | null = null;
  private lastConnectionAttemptAt = 0;

  constructor(
    private readonly settings: AppSettingsService,
    @Optional() @Inject(IWorkspaceRepositoryToken) private readonly workspaceRepo?: IWorkspaceRepository,
  ) {}

  private async getPiMcpConfigLoader() { return loadPiMcpConfigApi(); }

  getInstallUrl() { return INSTALL_URL; }

  private async configuredMemoryServer(cwd = process.cwd()): Promise<MemoryServer | null> {
    try {
      const agentDir = await this.settings.resolvePiAgentDir();
      // Use Pi's own config loader (including enabled/disabled overrides); do not spawn a client.
      const loadMcpConfig = await this.getPiMcpConfigLoader();
      const config = loadMcpConfig({ agentDir, cwd, projectTrusted: false });
      const entry = config.servers.find(isMemoryServer);
      if (!entry || entry.config.enabled === false) return null;
      return { name: entry.name };
    } catch {
      return null;
    }
  }

  async getSanitizedStatus() {
    const [globalEnabled, server] = await Promise.all([
      this.settings.getMemoryGlobalEnabled(),
      this.configuredMemoryServer(),
    ]);
    this.syncServer(server?.name ?? null);
    const configured = !!server;
    const available = configured && this.connectionState !== 'unavailable';
    const healthMessage = !configured
      ? 'No se detectó un MCP de memoria habilitado en la configuración global de Pi.'
      : this.connectionState === 'connected'
        ? `MCP conectado por Pi (${server!.name}).`
        : this.connectionState === 'unavailable'
          ? `Pi no pudo cargar las tools del MCP de memoria (${server!.name}).`
          : `MCP detectado en Pi (${server!.name}); conexión pendiente de la primera sesión.`;
    return {
      globalEnabled,
      configured,
      available,
      config: { configured, serverName: server?.name ?? null },
      health: {
        ok: this.connectionState === 'connected',
        checkedAt: new Date().toISOString(),
        message: healthMessage,
      },
      installUrl: INSTALL_URL,
    };
  }

  private isMemoryFlagEnabled(value: any): boolean {
    // SQLite/Sequelize may return booleans as 1/0 or "1"/"0".
    return value === true || value === 1 || value === '1';
  }

  async canDefaultWorkspaceMemoryOnCreate(): Promise<boolean> {
    const status = await this.getSanitizedStatus();
    return status.globalEnabled && status.configured && status.available;
  }

  async isMemoryEffective(agent: IAgent, workspace?: IWorkspace | null) {
    const [globalEnabled, server] = await Promise.all([
      this.settings.getMemoryGlobalEnabled(),
      this.configuredMemoryServer(),
    ]);
    this.syncServer(server?.name ?? null);
    if (this.connectionState === 'unavailable' && Date.now() - this.lastConnectionAttemptAt >= 30_000) {
      this.connectionState = 'unknown';
    }
    const ws = workspace || (this.workspaceRepo && agent.workspace_id ? await this.workspaceRepo.get(agent.workspace_id) : null);
    const workspaceEnabled = this.isMemoryFlagEnabled((ws as any)?.memory_enabled);
    const agentEnabled = this.isMemoryFlagEnabled((agent as any)?.memory_enabled);
    const configured = !!server;
    const effective = globalEnabled && configured && this.connectionState !== 'unavailable' && workspaceEnabled && agentEnabled;
    let reason = 'ok';
    if (!globalEnabled) reason = 'global_disabled';
    else if (!configured) reason = 'not_configured_in_pi';
    else if (this.connectionState === 'unavailable') reason = 'mcp_unavailable';
    else if (!workspaceEnabled) reason = 'workspace_disabled';
    else if (!agentEnabled) reason = 'agent_disabled';
    return { effective, reason, globalEnabled, configured, available: configured && this.connectionState !== 'unavailable', workspaceEnabled, agentEnabled };
  }

  recordPiSessionMemoryTools(toolNames: string[]): { available: boolean; reason: string } {
    this.lastConnectionAttemptAt = Date.now();
    const hasMemoryTool = toolNames.some((name) => /^mcp__.*__(memory_query|memory_trace)$/.test(name));
    this.connectionState = hasMemoryTool ? 'connected' : 'unavailable';
    return { available: hasMemoryTool, reason: hasMemoryTool ? 'Pi MCP tools loaded' : 'Pi MCP tools missing after session startup' };
  }

  private syncServer(serverName: string | null) {
    if (this.connectionServerName === serverName) return;
    this.connectionServerName = serverName;
    this.connectionState = 'unknown';
    this.lastConnectionAttemptAt = 0;
  }

  async decorateWorkspace<T extends Record<string, any>>(ws: T): Promise<any> {
    const status = await this.getSanitizedStatus();
    const preference = this.isMemoryFlagEnabled((ws as any).memory_enabled);
    return {
      ...ws,
      memory_enabled: (ws as any).memory_enabled ?? null,
      memoryPreference: preference,
      memoryEffective: !!(status.globalEnabled && status.configured && status.available && preference),
      memoryAvailable: status.available,
      memoryGlobalEnabled: status.globalEnabled,
      memoryConfigured: status.configured,
    };
  }

  async decorateAgent(agent: IAgent, workspace?: IWorkspace | null): Promise<any> {
    const ws = workspace || (this.workspaceRepo && agent.workspace_id ? await this.workspaceRepo.get(agent.workspace_id) : null);
    const status = await this.getSanitizedStatus();
    const workspacePreference = this.isMemoryFlagEnabled((ws as any)?.memory_enabled);
    const preference = this.isMemoryFlagEnabled((agent as any)?.memory_enabled);
    return {
      ...agent,
      memory_enabled: (agent as any)?.memory_enabled ?? null,
      memoryPreference: preference,
      memoryEffective: !!(status.globalEnabled && status.configured && status.available && workspacePreference && preference),
      memoryAvailable: status.available,
      memoryGlobalEnabled: status.globalEnabled,
      memoryConfigured: status.configured,
      memoryWorkspaceEnabled: workspacePreference,
    };
  }

  /**
   * Keep Pi's built-in MCP/codemode/tool-search extensions and transports, but filter the detected memory server
   * from this session when the workspace/agent preference is off. Other Pi MCP servers retain
   * their existing configuration and behavior.
   */
  async resourceLoaderOptions(memoryEnabled: boolean) {
    const agentDir = await this.settings.resolvePiAgentDir();
    const loadMcpConfig = await this.getPiMcpConfigLoader();
    // Expose all Pi-configured MCP servers (including memory) so every agent/session can use them.
    const extension = createMcpExtension({
      startupWaitMs: 5000,
      loadConfig: (ctx: any) => {
        const config = loadMcpConfig({ agentDir, cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() });
        return {
          ...config,
          servers: config.servers.map((entry: any) => isMemoryServer(entry)
            ? { ...entry, config: { ...entry.config, exposure: 'direct', toolExposure: { '*': 'direct', memory_query: 'direct', memory_trace: 'direct', memory_status: 'direct', memory_path: 'direct', memory_map: 'direct', memory_drift: 'direct', memory_record_decision: 'direct' } } }
            : entry),
        };
      },
    });
    return { extensionFactories: [createCodemodeExtension(), createToolSearchExtension(), extension] };
  }
}
