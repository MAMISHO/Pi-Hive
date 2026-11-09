import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Inject } from '@nestjs/common';
import { IWorkspace } from '../../../domain/models/workspace.interface.js';
import { IWorkspaceRepository, IWorkspaceRepositoryToken } from '../../../domain/repositories/workspace-repository.interface.js';

@Controller('workspaces')
export class WorkspaceController {
  constructor(@Inject(IWorkspaceRepositoryToken) private repo: IWorkspaceRepository) {}

  @Get()
  getAll() { return this.repo.getAll(); }

  @Get('active')
  getActive() { return this.repo.getActive(); }

  @Get(':id')
  getOne(@Param('id') id: string) { return this.repo.get(id); }

  @Post()
  async create(@Body() body: { name: string; path: string }) {
    const ws: IWorkspace = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `ws-${Date.now()}`,
      name: body.name || body.path.split('/').pop() || 'Workspace',
      path: body.path,
      is_active: true,
      created_at: new Date(),
    };
    await this.repo.setActive(ws.id).catch(() => {}); // ensure others inactive if any
    // but ws not created yet; create then set active
    const created = await this.repo.add(ws);
    await this.repo.setActive(created.id);
    return created;
  }

  @Put(':id/activate')
  async activate(@Param('id') id: string) {
    await this.repo.setActive(id);
    return { ok: true };
  }

  @Get('browse/dirs')
  browseDirs(@Query('path') dirPath?: string) {
    const target = dirPath && fs.existsSync(dirPath) ? dirPath : process.env.HOME || '/';
    try {
      const entries = fs.readdirSync(target, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const parent = path.dirname(target);
      return { current: target, parent: parent !== target ? parent : null, dirs };
    } catch (e: any) {
      return { current: target, parent: null, dirs: [], error: e?.message };
    }
  }
}
