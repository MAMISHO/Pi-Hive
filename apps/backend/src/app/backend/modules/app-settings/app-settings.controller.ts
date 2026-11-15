import { Body, Controller, Get, Inject, Optional, Post, Put } from '@nestjs/common';
import { AppSettingsService, PI_AGENT_DIR_KEY } from './app-settings.service.js';
import { NexoPalaceMemoryService } from '../memory-mcp/nexo-palace-memory.service.js';

@Controller('api/settings')
export class AppSettingsController {
  constructor(
    private readonly settings: AppSettingsService,
    @Optional() @Inject(NexoPalaceMemoryService) private readonly memory?: NexoPalaceMemoryService,
  ) {}

  private async payload() {
    const values = await (this.settings as any).getPublicValues ? (this.settings as any).getPublicValues() : await this.settings.getAll();
    const memory = this.memory
      ? await this.memory.getSanitizedStatus()
      : {
          globalEnabled: await this.settings.getMemoryGlobalEnabled(),
          configured: false,
          available: false,
          config: { configured: false, serverName: null },
          health: { ok: false, checkedAt: null, message: 'Servicio de detección Pi MCP no inicializado.' },
          installUrl: 'https://github.com/JonyDevProjects/nexo-palace',
        };
    return {
      values,
      defaults: { piAgentDir: this.settings.defaultPiAgentDir() },
      effective: { piAgentDir: await this.settings.resolvePiAgentDir() },
      memory,
    };
  }

  @Get()
  async getAll() {
    return this.payload();
  }

  @Put()
  async update(@Body() body: {
    piAgentDir?: string | null;
    memory?: { globalEnabled?: boolean };
  }) {
    if (body && Object.prototype.hasOwnProperty.call(body, 'piAgentDir')) {
      const v = body.piAgentDir;
      await this.settings.set(PI_AGENT_DIR_KEY, v == null ? null : String(v));
    }
    if (body?.memory && Object.prototype.hasOwnProperty.call(body.memory, 'globalEnabled')) {
      await this.settings.setMemoryGlobalEnabled(!!body.memory.globalEnabled);
    }
    return this.payload();
  }

  @Post('memory/health')
  async memoryHealth() {
    // Refreshes detection against Pi's MCP config; no second connection is created here.
    return this.payload();
  }
}
