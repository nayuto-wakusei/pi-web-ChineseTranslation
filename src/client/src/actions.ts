export interface AppAction {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  group?: string;
  enabled?: boolean;
  run: () => void | Promise<void>;
}
