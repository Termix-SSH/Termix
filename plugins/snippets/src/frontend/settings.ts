export interface SnippetDisplaySettings {
  foldersCollapsed: boolean;
  showCommands: boolean;
  confirmExecution: boolean;
}

export function readSnippetSettings(
  values: Record<string, unknown>,
): SnippetDisplaySettings {
  return {
    foldersCollapsed: values.foldersCollapsed !== false,
    showCommands: values.showCommands !== false,
    confirmExecution: values.confirmExecution === true,
  };
}
