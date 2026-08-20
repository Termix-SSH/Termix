type SFTPWrapper = import("ssh2").SFTPWrapper;

export function promisifySftpStat(
  sftp: SFTPWrapper,
  path: string,
): Promise<import("ssh2").Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (err, stats) => {
      if (err) reject(err);
      else resolve(stats);
    });
  });
}

export function promisifySftpUnlink(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(path, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function promisifySftpRmdir(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(path, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function promisifySftpMkdir(
  sftp: SFTPWrapper,
  path: string,
  mode: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(path, { mode }, (err) => {
      if (err && (err as NodeJS.ErrnoException).code !== "EEXIST") {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

export function promisifySftpChmod(
  sftp: SFTPWrapper,
  path: string,
  mode: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.chmod(path, mode, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function promisifySftpReaddir(
  sftp: SFTPWrapper,
  path: string,
): Promise<Array<{ filename: string; attrs: import("ssh2").Stats }>> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (err, list) => {
      if (err) reject(err);
      else resolve(list);
    });
  });
}

export function promisifySftpOpen(
  sftp: SFTPWrapper,
  path: string,
  flags: number,
  mode: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.open(path, flags, mode, (err, handle) => {
      if (err) reject(err);
      else resolve(handle);
    });
  });
}

export function promisifySftpClose(sftp: SFTPWrapper, handle: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.close(handle, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function promisifySftpFstat(
  sftp: SFTPWrapper,
  handle: Buffer,
): Promise<import("ssh2").Stats> {
  return new Promise((resolve, reject) => {
    sftp.fstat(handle, (err, stats) => {
      if (err) reject(err);
      else resolve(stats);
    });
  });
}
