import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RunUsage, UsageTotals, emptyTotals } from '../../../core/services/token-usage.service';
import { IAgent } from '../../../core/models/agent.model';

@Component({
  selector: 'app-usage',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './usage.component.html',
  styleUrl: './usage.component.scss',
})
export class UsageComponent implements OnChanges {
  @Input() usageRuns: RunUsage[] = [];
  @Input() usageTotals: UsageTotals = emptyTotals();
  @Input() agents: IAgent[] = [];

  private agentMap = new Map<string, IAgent>();

  ngOnChanges(changes: any): void {
    if (changes['agents']) this.agentMap = new Map((this.agents || []).map(a => [a.id, a]));
  }

  fmtNum(n: any): string { const v = Number(n || 0); return v.toLocaleString('en-US'); }
  fmtCost(n: any): string { const v = Number(n || 0); if (v === 0) return '$0.00'; if (v > 0 && v < 0.01) return '$' + v.toFixed(4); return '$' + v.toFixed(2); }
  fmtTime(ts: any): string { if (!ts) return ''; try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; } }

  agentColor(id: string): string {
    const a = this.agentMap.get(id); if ((a as any)?.archived_at) return 'var(--text-muted,#6b7280)'; if (a?.color) return a.color; if (id === 'user') return '#9ca3af';
    let h = 0; for (let i = 0; i < (id || '').length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360} 65% 55%)`;
  }
  label(id: string): string { if (id === 'user') return 'user'; const a = this.agentMap.get(id); if ((a as any)?.archived_at) return 'Deshabilitado'; return a?.nickname || (id ? id.slice(0, 8) : ''); }
}