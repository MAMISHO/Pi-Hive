import { Injectable } from '@nestjs/common';
import * as os from 'os';
import * as path from 'path';
import { AppSettingEntity } from './infra/persistence/sequalize/entities/app-setting.schema.js';

export const PI_AGENT_DIR_KEY = 'pi.agentDir';

@Injectable()
export class AppSettingsService {
  async get(key: string): Promise<string | null> {
    try {
      const row = await AppSettingEntity.findByPk(key);
      const v = (row as any)?.get ? (row as any).get('value') : (row as any)?.value;
      return v == null || v === '' ? null : String(v);
    } catch {
      return null;
    }
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
    } catch {
      return {};
    }
  }

  defaultPiAgentDir(): string {
    const env = String(process.env.PI_CODING_AGENT_DIR || '').trim();
    if (env) return env;
    return path.join(os.homedir(), '.pi', 'agent');
  }

  async resolvePiAgentDir(): Promise<string> {
    const configured = await this.get(PI_AGENT_DIR_KEY);
    if (configured && String(configured).trim()) return String(configured).trim();
    return this.defaultPiAgentDir();
  }
}
