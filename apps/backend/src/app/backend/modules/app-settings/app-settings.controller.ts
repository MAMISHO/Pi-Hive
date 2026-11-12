import { Body, Controller, Get, Put } from '@nestjs/common';
import { AppSettingsService, PI_AGENT_DIR_KEY } from './app-settings.service.js';

@Controller('api/settings')
export class AppSettingsController {
  constructor(private readonly settings: AppSettingsService) {}

  @Get()
  async getAll() {
    const values = await this.settings.getAll();
    return {
      values,
      defaults: { piAgentDir: this.settings.defaultPiAgentDir() },
      effective: { piAgentDir: await this.settings.resolvePiAgentDir() },
    };
  }

  @Put()
  async update(@Body() body: { piAgentDir?: string | null }) {
    if (body && Object.prototype.hasOwnProperty.call(body, 'piAgentDir')) {
      const v = body.piAgentDir;
      await this.settings.set(PI_AGENT_DIR_KEY, v == null ? null : String(v));
    }
    const values = await this.settings.getAll();
    return {
      values,
      defaults: { piAgentDir: this.settings.defaultPiAgentDir() },
      effective: { piAgentDir: await this.settings.resolvePiAgentDir() },
    };
  }
}
