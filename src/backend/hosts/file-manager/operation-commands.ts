import { isWindowsSftpPath, sftpPathToLocalPath } from "../transfer-paths.js";

export interface DeleteCommand {
  command: string;
  commandWithSuccess: string;
}

function quotePosixPath(path: string): string {
  return `'${path.replace(/'/g, "'\"'\"'")}'`;
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildDeleteCommand(
  itemPath: string,
  isDirectory: boolean,
): DeleteCommand {
  if (isWindowsSftpPath(itemPath)) {
    const path = quotePowerShellLiteral(sftpPathToLocalPath(itemPath));
    const command = isDirectory
      ? `Remove-Item -LiteralPath ${path} -Recurse -Force -ErrorAction Stop`
      : `Remove-Item -LiteralPath ${path} -Force -ErrorAction Stop`;

    return {
      command,
      commandWithSuccess: `${command}; if ($?) { Write-Output "SUCCESS" }`,
    };
  }

  const path = quotePosixPath(itemPath);
  const command = isDirectory ? `rm -rf ${path}` : `rm -f ${path}`;

  return {
    command,
    commandWithSuccess: `${command} && echo "SUCCESS"`,
  };
}
