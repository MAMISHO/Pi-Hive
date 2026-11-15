import { AppSettingsService } from './app-settings.service.js';
import { AppSettingEntity } from './infra/persistence/sequalize/entities/app-setting.schema.js';

jest.mock('./infra/persistence/sequalize/entities/app-setting.schema.js', () => ({
  AppSettingEntity: { findByPk: jest.fn(), destroy: jest.fn(), upsert: jest.fn(), findAll: jest.fn() },
}));

describe('AppSettingsService memory preference', () => {
  const store = new Map<string, string>();
  let svc: AppSettingsService;

  beforeEach(() => {
    store.clear();
    svc = new AppSettingsService();
    (AppSettingEntity.findAll as jest.Mock).mockImplementation(async () => Array.from(store.entries()).map(([key, value]) => ({ get: (k: string) => (k === 'key' ? key : value), key, value })));
    (AppSettingEntity.upsert as jest.Mock).mockImplementation(async ({ key, value }: any) => { store.set(String(key), String(value)); });
    (AppSettingEntity.destroy as jest.Mock).mockImplementation(async ({ where }: any) => { store.delete(String(where.key)); });
    (AppSettingEntity.findByPk as jest.Mock).mockImplementation(async (key: string) => store.has(key) ? ({ get: (k: string) => (k === 'value' ? store.get(key) : key), value: store.get(key) }) : null);
  });

  it('stores only the Pi-Hive global preference and hides legacy Pi-Hive MCP connection fields', async () => {
    await svc.setMemoryGlobalEnabled(true);
    store.set('memory.mcp.command', 'legacy-secret');
    expect(await svc.getMemoryGlobalEnabled()).toBe(true);
    expect(await svc.getPublicValues()).toEqual({ 'memory.globalEnabled': 'true' });
  });

  it('defaults memory on when no preference exists, while preserving an explicit opt-out', async () => {
    expect(await svc.getMemoryGlobalEnabled()).toBe(true);
    await svc.setMemoryGlobalEnabled(false);
    expect(await svc.getMemoryGlobalEnabled()).toBe(false);
  });

  it('uses Pi agent directory setting or Pi default', async () => {
    expect(await svc.resolvePiAgentDir()).toBe(svc.defaultPiAgentDir());
  });
});
