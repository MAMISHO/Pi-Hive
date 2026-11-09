import { AgentEntity } from '../entities/agent.schema.js';
import { IAgent } from '../../../../domain/models/agent.interface.js';

export class AgentMapper {
  static toDomain(entity: AgentEntity): IAgent {
    const json = entity.toJSON() as IAgent;
    return {
      id: json.id,
      name: json.name,
      nickname: json.nickname,
      role: json.role,
      status: json.status,
      current_session_id: json.current_session_id,
      task_state: json.task_state,
      workspace_id: json.workspace_id,
      additional_instruction: json.additional_instruction ?? null,
      color: json.color ?? null,
    };
  }

  static toPersistence(agent: IAgent): Partial<AgentEntity> {
    return {
      id: agent.id,
      name: agent.name,
      nickname: agent.nickname,
      role: agent.role as any,
      status: agent.status as any,
      current_session_id: agent.current_session_id,
      task_state: agent.task_state,
      workspace_id: agent.workspace_id,
      additional_instruction: agent.additional_instruction ?? null,
      color: agent.color ?? null,
    };
  }
}
