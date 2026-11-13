import { Controller, Get, Param, Query } from '@nestjs/common';
import { Op } from 'sequelize';
import { AgentChatEventEntity } from '../persistence/sequalize/entities/agent-chat-event.schema.js';

type LightEvent = any & { contentDeferred?: boolean; detailLoaded?: boolean };

const isIntermediate = (kind: string) => kind === 'thinking' || kind === 'tool_call' || kind === 'tool_group' || kind === 'tool_result';

@Controller('chat-transcript')
export class ChatTranscriptController {
  @Get('agent/:agentId')
  async getForAgent(
    @Param('agentId') agentId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
    @Query('mode') mode?: string,
  ) {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const light = mode !== 'full';
    const where: any = { agent_id: agentId };
    if (before) where.id = { [Op.lt]: Number(before) };

    // Overfetch then build a compact window: for completed turns collapse intermediates
    // into a single placeholder group so request/response dominate the budget.
    const fetchLimit = light ? Math.min(lim * 12, 1200) : lim;
    const rows = await AgentChatEventEntity.findAll({
      where,
      order: [['id', 'DESC']],
      limit: fetchLimit,
    });
    // chronological
    const chrono = rows.map((r) => r.toJSON() as any).reverse();

    if (!light) {
      return chrono;
    }

    const responseIdsByTask = new Map<string, number>();
    for (const ev of chrono) {
      if (ev.kind === 'response' && ev.task_id != null) responseIdsByTask.set(String(ev.task_id), ev.id);
    }

    // Build compact list: collapse intermediates of completed turns into one group node.
    const compact: any[] = [];
    const groupKey = (taskId: any) => `grp:${taskId}`;
    const groups = new Map<string, any>();
    for (const ev of chrono) {
      const tid = ev.task_id != null ? String(ev.task_id) : null;
      const completed = tid != null && responseIdsByTask.has(tid);
      if (completed && isIntermediate(ev.kind)) {
        const k = groupKey(tid);
        let g = groups.get(k);
        if (!g) {
          g = {
            id: `group-${tid}-${ev.id}`,
            synthetic: true,
            agent_id: ev.agent_id,
            task_id: ev.task_id,
            parent_task_id: ev.parent_task_id ?? null,
            direction: 'OUTBOUND',
            kind: 'intermediate_group',
            content: null,
            contentDeferred: true,
            detailLoaded: false,
            created_at: ev.created_at,
            count: 0,
            kinds: {} as Record<string, number>,
          };
          groups.set(k, g);
          compact.push(g);
        }
        g.count += 1;
        g.kinds[ev.kind] = (g.kinds[ev.kind] || 0) + 1;
        // keep group's position anchored near first intermediate (already inserted)
        continue;
      }
      compact.push(ev);
    }

    // Keep last `lim` items from compact view (counting group as 1 item)
    let cutIndex = compact.length > lim ? compact.length - lim : 0;
    let windowed = compact.slice(cutIndex);

    // Ensure request/response pairs are present: if a response is in window, include its request & group
    const hasInWindow = (pred: (e: any) => boolean) => windowed.some(pred);
    const ensureIncluded = (ev: any) => {
      if (!ev) return;
      if (!windowed.includes(ev)) windowed.unshift(ev);
    };
    for (let i = cutIndex - 1; i >= 0; i--) {
      const ev = compact[i];
      if (ev.kind === 'response' && ev.task_id != null) continue;
      if (ev.kind === 'request' && ev.task_id != null && hasInWindow(w => w.kind === 'response' && String(w.task_id) === String(ev.task_id))) {
        ensureIncluded(ev);
        // also ensure its intermediate group if exists and response present
        const g = groups.get(groupKey(String(ev.task_id)));
        if (g && hasInWindow(w => w.kind === 'response' && String(w.task_id) === String(ev.task_id))) ensureIncluded(g);
      }
    }
    // if a request made it in but its group was cut, bring group back (keeps fold between req/resp)
    for (const ev of [...windowed]) {
      if (ev.kind === 'response' && ev.task_id != null) {
        const g = groups.get(groupKey(String(ev.task_id)));
        if (g && !windowed.includes(g)) {
          // insert before response
          const ri = windowed.indexOf(ev);
          if (ri >= 0) windowed.splice(ri, 0, g); else windowed.unshift(g);
        }
        const req = compact.find(e => e.kind === 'request' && String(e.task_id) === String(ev.task_id));
        if (req && !windowed.includes(req)) windowed.unshift(req);
      }
    }

    // stable chronological order by original anchor: use created_at/id proxy
    windowed.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (ta !== tb) return ta - tb;
      const ia = typeof a.id === 'number' ? a.id : 0;
      const ib = typeof b.id === 'number' ? b.id : 0;
      return ia - ib;
    });

    const hasMore = cutIndex > 0 || !!before;
    if (windowed.length > 0) (windowed as any)._meta = { hasMore, oldestId: windowed[0]?.id };
    return windowed;
  }

  @Get('event/:id')
  async getEventDetail(@Param('id') id: string) {
    const row = await AgentChatEventEntity.findByPk(Number(id));
    if (!row) return null;
    return row.toJSON();
  }

  @Get('agent/:agentId/task/:taskId/intermediates')
  async getTaskIntermediates(@Param('agentId') agentId: string, @Param('taskId') taskId: string) {
    const rows = await AgentChatEventEntity.findAll({
      where: {
        agent_id: agentId,
        task_id: Number(taskId),
        kind: { [Op.in]: ['thinking', 'tool_call', 'tool_group', 'tool_result'] },
      },
      order: [['id', 'ASC']],
      limit: 1000,
    });
    return rows.map((r) => r.toJSON());
  }
}
