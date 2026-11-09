export interface IWorkspace {
  id: string;
  name: string;
  path: string;
  is_active: boolean;
  active_system_prompt_id: string | null;
  custom_chief_prompt: string | null;
  hitl_enabled: boolean;
  created_at: Date | string | null;
}
