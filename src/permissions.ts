import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

type PermissionId = 'accessibility' | 'screenshots';
type PermissionStatus = 'granted' | 'not-granted';
type JavisPermissionStatus = { platform: 'darwin'; permissions: { id: PermissionId; status: PermissionStatus }[] };
const permissionIds: PermissionId[] = ['accessibility', 'screenshots'];

function appPath(): string {
  return resolve(process.env.JAVIS_APP_PATH || join(homedir(), 'Applications', 'Javis.app'));
}

function launch(args: string[]): Promise<void> {
  return new Promise((resolveLaunch, reject) => {
    execFile('/usr/bin/open', ['-n', appPath(), '--args', ...args], { timeout: 5000 }, (error) => {
      if (error) reject(error);
      else resolveLaunch();
    });
  });
}

function parseStatus(text: string): JavisPermissionStatus {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || permissionIds.some((id) => {
    const status = (raw as Record<string, unknown>)[id];
    return status !== 'granted' && status !== 'not-granted';
  })) throw new Error('Invalid Javis permission status');
  return { platform: 'darwin', permissions: permissionIds.map((id) => ({
    id, status: (raw as Record<PermissionId, PermissionStatus>)[id],
  })) };
}

export async function readJavisPermissionStatus(): Promise<JavisPermissionStatus> {
  const directory = await mkdtemp(join(tmpdir(), 'javis-permissions-'));
  const resultPath = join(directory, 'status.json');
  try {
    await launch(['--permission-status-file', resultPath]);
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        return parseStatus(await readFile(resultPath, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (Date.now() >= deadline) throw new Error('Timed out waiting for Javis permission status');
        await delay(50);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function openJavisPermissions(id?: PermissionId): Promise<void> {
  if (id !== undefined && !permissionIds.includes(id)) throw new Error('Invalid Javis permission');
  await launch(id === undefined ? ['--permissions'] : ['--permission', id]);
}
