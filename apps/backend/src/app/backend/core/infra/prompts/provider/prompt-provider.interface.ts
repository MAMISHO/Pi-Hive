export const IPromptProviderToken = 'IPromptProvider';

export interface IPromptProvider {
  get(name: string): string;
  getSystemDefault(): string;
  getChiefDefault(): string;
  getWorkerCoordination(): string;
}
