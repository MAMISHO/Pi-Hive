import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TaskService } from '../../core/services/task.service';
import { WebsocketService } from '../../core/services/websocket.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { AgentService } from '../../core/services/agent.service';
import { UiFeedbackService } from '../../core/services/ui-feedback.service';
import { TokenUsageService, RunUsage, UsageTotals, emptyTotals } from '../../core/services/token-usage.service';
import { ITaskQueue } from '../../core/models/task.model';
import { IAgent } from '../../core/models/agent.model';
import { LineageComponent } from './lineage/lineage.component';
import { UsageComponent } from './usage/usage.component';

@Component({
  selector: 'app-sidebar-right',
  standalone: true,
  imports: [CommonModule, LineageComponent, UsageComponent],
  templateUrl: './sidebar-right.component.html',
  styleUrl: './sidebar-right.component.scss',
})
export class SidebarRightComponent implements OnInit, OnDestroy {
  activeTab: 'lineage' | 'usage' = 'lineage';
  tasks: ITaskQueue[] = [];
  agents: IAgent[] = [];
  usageRuns: RunUsage[] = [];
  usageTotals: UsageTotals = emptyTotals();
  private subs: Subscription[] = [];

  constructor(
    private taskService: TaskService,
    private ws: WebsocketService,
    private workspace: WorkspaceService,
    private agentService: AgentService,
    private cdr: ChangeDetectorRef,
    private feedback: UiFeedbackService,
    private tokenUsage: TokenUsageService,
  ) {}

  ngOnInit(): void {
    this.load();
    const rel = () => this.load();
    this.subs.push(this.ws.statusChange$.subscribe(rel));
    this.subs.push(this.ws.taskUpdated$.subscribe(rel));
    this.subs.push(this.ws.tasksCleared$.subscribe(rel));
    this.subs.push(this.workspace.active$.subscribe(rel));
    this.subs.push((this.ws as any).transcriptCleared$?.subscribe(rel) || ({ unsubscribe() {} } as any));
    this.subs.push(this.tokenUsage.runs$.subscribe(r => { this.usageRuns = r; this.cdr.detectChanges(); }));
    this.subs.push(this.tokenUsage.workspaceTotals$.subscribe(t => { this.usageTotals = t; this.cdr.detectChanges(); }));
  }

  setTab(tab: 'lineage' | 'usage') {
    this.activeTab = tab;
  }

  load(): void {
    const ws = this.workspace.active;
    if (!ws) {
      this.tasks = []; this.agents = [];
      this.cdr.detectChanges();
      return;
    }
    const tasks$ = this.taskService.getByWorkspace(ws.id).pipe(catchError(() => of([] as ITaskQueue[])));
    const agents$ = this.agentService.getByWorkspace(ws.id).pipe(catchError(() => of([] as IAgent[])));
    forkJoin({ list: tasks$, ags: agents$ }).subscribe(({ list, ags }) => {
      const wsAgents = ((ags as IAgent[]) || []).filter((a: any) => !ws || a.workspace_id === ws.id);
      this.agents = wsAgents.filter((a: any) => !(a as any).archived_at);
      const archivedIds = new Set(wsAgents.filter((a: any) => !!(a as any).archived_at).map(a => a.id));
      this.tasks = ((list as ITaskQueue[]) || []).filter(t => !archivedIds.has(t.sender_agent_id) && !archivedIds.has(t.receiver_agent_id));
      this.cdr.detectChanges();
    });
  }

  async clearLineage(): Promise<void> {
    const ws = this.workspace.active; if (!ws) return;
    const ok = await this.feedback.confirm({ title: 'Limpiar Task Lineage', message: '¿Limpiar todo el Task Lineage de este workspace?\nSe eliminarán las tareas registradas.', confirmLabel: 'Limpiar', danger: true });
    if (!ok) return;
    const onDone = () => { this.feedback.success('Task Lineage limpiado.'); this.load(); };
    const onErr = () => this.feedback.error('No se pudo limpiar el Task Lineage.');
    if ((this.taskService as any).clearByWorkspace) {
      (this.taskService as any).clearByWorkspace(ws.id).subscribe({ next: onDone, error: onErr });
    } else {
      fetch(`http://localhost:8090/tasks/workspace/${ws.id}/clear`, { method: 'DELETE' }).then(onDone).catch(onErr);
    }
  }

  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }
}