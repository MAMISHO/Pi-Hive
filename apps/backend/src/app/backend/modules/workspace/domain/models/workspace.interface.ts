export interface IWorkspace {
  id: string;
  name: string;
  path: string;
  is_active: boolean;
  created_at: Date | string | null;
}
