export interface StreamTextEvent {
  agentId: string;
  delta: string;
  kind?: 'thinking' | 'text';
}

export interface StreamToolEvent {
  agentId: string;
  toolName: string;
  args: any;
}

export interface StatusChangeEvent {
  agentId: string;
  status: 'IDLE' | 'WORKING' | 'PAUSED';
}
