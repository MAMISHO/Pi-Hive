import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { IAgent } from '../models/agent.model';

@Injectable({ providedIn: 'root' })
export class AgentSelectionService {
  private selectedAgentSubject = new BehaviorSubject<IAgent | null>(null);
  selectedAgent$ = this.selectedAgentSubject.asObservable();

  get selectedAgent(): IAgent | null {
    return this.selectedAgentSubject.getValue();
  }

  set selectedAgent(agent: IAgent | null) {
    this.selectedAgentSubject.next(agent);
  }

  select(agent: IAgent | null): void {
    this.selectedAgentSubject.next(agent);
  }
}