export interface IWorkspaceSystemPrompt {
  id: string;
  workspace_id: string | null; // null for immutable global default
  name: string;
  content: string;
  is_default: boolean;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}
