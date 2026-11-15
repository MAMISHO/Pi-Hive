import { Injectable } from '@nestjs/common';
import * as os from 'os';
import * as path from 'path';
import { AppSettingEntity } from './infra/persistence/sequalize/entities/app-setting.schema.js';

export const PI_AGENT_DIR_KEY = 'pi.agentDir';
export const MEMORY_GLOBAL_ENABLED_KEY = 'memory.globalEnabled';

@Injectable()
export class AppSettingsService {
  async get(key: string): Promise<string | null> {
    try {
      const row = await AppSettingEntity.findByPk(key);
      const v = (row as any)?.get ? (row as any).get('value') : (row as any)?.value;
      return v == null || v === '' ? null : String(v);
    } catch { return null; }
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value == null || String(value).trim() === '') {
      await AppSettingEntity.destroy({ where: { key } as any }).catch(() => {});
      return;
    }
    await AppSettingEntity.upsert({ key, value: String(value).trim(), updated_at: new Date() } as any);
  }

  async getAll(): Promise<Record<string, string>> {
    try {
      const rows = await AppSettingEntity.findAll();
      const out: Record<string, string> = {};
      for (const r of rows as any[]) {
        const k = r.get ? r.get('key') : r.key;
        const v = r.get ? r.get('value') : r.value;
        if (k && v != null && v !== '') out[String(k)] = String(v);
      }
      return out;
    } catch { return {}; }
  }

  async getPublicValues(): Promise<Record<string, string>> {
    const all = await this.getAll();
    return Object.fromEntries(Object.entries(all).filter(([key]) =>
      !key.startsWith('memory.mcp.'), // hide legacy values from the removed Pi-Hive-owned MCP config
    ));
  }

  defaultPiAgentDir(): string {
    const env = String(process.env.PI_CODING_AGENT_DIR || '').trim();
    if (env) return env;
    return path.join(os.homedir(), '.pi', 'agent');
  }

  async resolvePiAgentDir(): Promise<string> {
    const configured = await this.get(PI_AGENT_DIR_KEY);
    return configured?.trim() || this.defaultPiAgentDir();
  }

  async getMemoryGlobalEnabled(): Promise<boolean> {
    const saved = await this.get(MEMORY_GLOBAL_ENABLED_KEY);
    // The integration is still unavailable until Pi's MCP is detected. Default-on lets an
    // already configured Pi server become usable without requiring a duplicate enable step;
    // an explicit user choice (including false) remains authoritative.
    return saved == null ? true : saved === 'true';
  }

  async setMemoryGlobalEnabled(enabled: boolean): Promise<void> {
    await this.set(MEMORY_GLOBAL_ENABLED_KEY, enabled ? 'true' : 'false');
  }
}
