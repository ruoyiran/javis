import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { JavisError } from './runtime/error.js';
import { reapHelper } from './runtime/helper-reaping.js';

type PermissionId = 'accessibility' | 'screenshots';
type PermissionStatus = 'granted' | 'not-granted' | 'unsupported';
export type JavisPermissionStatus = { platform: NodeJS.Platform; permissions: { id: PermissionId; status: PermissionStatus }[] };
export type JavisPermissionSetupResult = JavisPermissionStatus & {
  helperAppPath: string | null;
  permissionId: PermissionId | null;
  openedSettings: boolean;
  launchedHelper: boolean;
  launchSuperseded?: boolean;
  nextStep: string | null;
};
const permissionIds: PermissionId[] = ['accessibility', 'screenshots'];
const bundleId = 'com.royran.javis';
const minimumLaunchGapMs = 5000;
const statusCacheMs = 5000;
const statusDeadlineMs = 5000;

let gate: Promise<void> = Promise.resolve();
let lastLaunchAt = -Infinity;
let cachedStatus: { value: JavisPermissionStatus; expiresAt: number } | undefined;
let statusInFlight: Promise<JavisPermissionStatus> | undefined;
let resetInFlight: Promise<JavisPermissionStatus> | undefined;
let activeStatus: AbortController | undefined;
let epoch = 0;
let setupSequence = 0;
type SetupRequest = {
  sequence: number;
  version: number;
  result: JavisPermissionSetupResult;
  canDeliver: () => boolean;
  resolve: (result: JavisPermissionSetupResult) => void;
  reject: (error: unknown) => void;
};
let queuedSetup: SetupRequest | undefined;
let setupWorker: Promise<void> | undefined;
let activeSetup: AbortController | undefined;

function assertPermissionDelivery(version: number, canDeliver: () => boolean): void {
  if (version !== epoch || !canDeliver()) {
    throw new JavisError('action_timeout', 'Permission request was cancelled before delivery');
  }
}

export function cancelJavisPermissionOperations(): void {
  epoch += 1;
  cachedStatus = undefined;
  activeStatus?.abort();
  statusInFlight = undefined;
  cancelQueuedSetup();
}

function permissionCancelled(): JavisError {
  return new JavisError('action_timeout', 'Permission request was cancelled before delivery');
}

function cancelQueuedSetup(): void {
  activeSetup?.abort();
  queuedSetup?.reject(permissionCancelled());
  queuedSetup = undefined;
}

function supersedeQueuedSetup(): void {
  queuedSetup?.resolve({ ...queuedSetup.result, launchSuperseded: true });
  queuedSetup = undefined;
}

function startSetupWorker(): void {
  if (setupWorker || !queuedSetup) return;
  const controller = new AbortController();
  const version = epoch;
  activeSetup = controller;
  const pending = serialized(async () => {
    try {
      while (queuedSetup && !controller.signal.aborted) {
        await pace(controller.signal);
        const request = queuedSetup;
        queuedSetup = undefined;
        if (!request) continue;
        try {
          assertPermissionDelivery(request.version, request.canDeliver);
          // A newer request may still be preflighting status behind this worker.
          // Its arrival already supersedes this queued UI even before it can enqueue.
          if (request.sequence !== setupSequence) {
            request.resolve({ ...request.result, launchSuperseded: true });
            continue;
          }
          await closeSetupHelpers(request.result.helperAppPath!);
          assertPermissionDelivery(request.version, request.canDeliver);
          if (request.sequence !== setupSequence) {
            request.resolve({ ...request.result, launchSuperseded: true });
            continue;
          }
          await command('/usr/bin/open', ['-n', request.result.helperAppPath!, '--args', ...(
            request.result.permissionId === null ? ['--permissions'] : ['--permission', request.result.permissionId]
          )], 5000, controller.signal);
          cachedStatus = undefined;
          request.resolve({
            ...request.result,
            launchedHelper: true,
            openedSettings: request.result.permissionId !== null,
          });
        } catch (error) {
          request.reject(controller.signal.aborted || request.version !== epoch ? permissionCancelled() : error);
        }
      }
    } catch (error) {
      if (queuedSetup?.version === version) {
        queuedSetup.reject(controller.signal.aborted || version !== epoch ? permissionCancelled() : error);
        queuedSetup = undefined;
      }
    }
  });
  const worker = pending.finally(() => {
    if (activeSetup === controller) activeSetup = undefined;
    if (setupWorker === worker) setupWorker = undefined;
    startSetupWorker();
  });
  setupWorker = worker;
}

function appPath(): string {
  return resolve(process.env.JAVIS_APP_PATH || join(homedir(), 'Applications', 'Javis.app'));
}

async function closeSetupHelpers(helperAppPath: string): Promise<void> {
  const executable = join(helperAppPath, 'Contents/MacOS/javis-helper');
  // Full-command, same-UID matching preserves status probes and authenticated agents.
  for (const args of ['--permissions', '--permission accessibility', '--permission screenshots']) {
    await reapHelper(`${executable} ${args}`);
  }
}

function command(path: string, args: string[], timeout = 5000, signal?: AbortSignal): Promise<string> {
  return new Promise((resolveCommand, reject) => {
    execFile(path, args, { timeout, ...(signal ? { signal } : {}) }, (error, stdout) => {
      if (error) reject(error);
      else resolveCommand(stdout);
    });
    if (path === '/usr/bin/open') lastLaunchAt = performance.now();
  });
}

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const pending = gate.then(work, work);
  gate = pending.then(() => {}, () => {});
  return pending;
}

async function pace(signal?: AbortSignal): Promise<void> {
  const remaining = minimumLaunchGapMs - (performance.now() - lastLaunchAt);
  if (remaining > 0) await delay(remaining, undefined, { signal });
  if (signal?.aborted) throw new JavisError('action_timeout', 'Permission status request was cancelled');
}

function parseStatus(text: string): JavisPermissionStatus {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || permissionIds.some((id) => {
    const status = (raw as Record<string, unknown>)[id];
    return status !== 'granted' && status !== 'not-granted';
  })) throw new Error('Invalid Javis permission status');
  return { platform: 'darwin', permissions: permissionIds.map((id) => ({
    id, status: (raw as Record<PermissionId, 'granted' | 'not-granted'>)[id],
  })) };
}

async function probeStatus(version: number, controller: AbortController): Promise<JavisPermissionStatus> {
  const directory = await mkdtemp(join(tmpdir(), 'javis-permissions-'));
  const resultPath = join(directory, 'status.json');
  const executable = join(appPath(), 'Contents/MacOS/javis-helper');
  const helperCommand = `${executable} --permission-status-file ${resultPath}`;
  let completed = false;
  try {
    if (version !== epoch) throw new JavisError('action_timeout', 'Permission status request was cancelled');
    await command('/usr/bin/open', ['-g', '-n', appPath(), '--args', '--permission-status-file', resultPath], 5000, controller.signal);
    const deadline = performance.now() + statusDeadlineMs;
    while (true) {
      if (controller.signal.aborted || version !== epoch) throw new JavisError('action_timeout', 'Permission status request was cancelled');
      try {
        const value = parseStatus(await readFile(resultPath, 'utf8'));
        completed = true;
        return value;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (performance.now() >= deadline) throw new JavisError('action_timeout', 'Timed out waiting for Javis permission status');
        await delay(50, undefined, { signal: controller.signal });
      }
    }
  } finally {
    try { if (!completed) await reapHelper(helperCommand); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}

async function pacedStatus(version: number, controller: AbortController): Promise<JavisPermissionStatus> {
  if (controller.signal.aborted || version !== epoch) throw new JavisError('action_timeout', 'Permission status request was cancelled');
  await pace(controller.signal);
  if (version !== epoch) throw new JavisError('action_timeout', 'Permission status request was cancelled');
  const value = await probeStatus(version, controller);
  if (version !== epoch) throw new JavisError('action_timeout', 'Permission status request was cancelled');
  cachedStatus = { value, expiresAt: performance.now() + statusCacheMs };
  return value;
}

export async function readJavisPermissionStatus(): Promise<JavisPermissionStatus> {
  if (process.platform !== 'darwin') return { platform: process.platform, permissions: permissionIds.map((id) => ({ id, status: 'unsupported' })) };
  if (resetInFlight) return resetInFlight;
  if (cachedStatus && cachedStatus.expiresAt > performance.now()) return cachedStatus.value;
  if (!statusInFlight) {
    const version = epoch;
    const controller = new AbortController();
    activeStatus = controller;
    const pending = serialized(() => pacedStatus(version, controller));
    const coalesced: Promise<JavisPermissionStatus> = pending.finally(() => {
      if (statusInFlight === coalesced) statusInFlight = undefined;
      if (activeStatus === controller) activeStatus = undefined;
    });
    statusInFlight = coalesced;
  }
  return statusInFlight;
}

export async function openJavisPermissions(id?: PermissionId, canDeliver: () => boolean = () => true): Promise<JavisPermissionSetupResult> {
  if (id !== undefined && !permissionIds.includes(id)) throw new JavisError('invalid_argument', 'Invalid Javis permission');
  const version = epoch;
  const sequence = ++setupSequence;
  assertPermissionDelivery(version, canDeliver);
  const status = await readJavisPermissionStatus();
  assertPermissionDelivery(version, canDeliver);
  const missing = status.permissions.find(permission => permission.status === 'not-granted');
  const result: JavisPermissionSetupResult = {
    ...status,
    helperAppPath: process.platform === 'darwin' ? appPath() : null,
    permissionId: id ?? null,
    openedSettings: false,
    launchedHelper: false,
    nextStep: missing ? `Grant ${missing.id === 'accessibility' ? 'Accessibility' : 'Screen Recording'} to Javis in System Settings, then retry get-app-state.` : null,
  };
  if (process.platform !== 'darwin') return result;
  if (sequence !== setupSequence) return { ...result, launchSuperseded: true };
  supersedeQueuedSetup();
  if (id === undefined && !missing) return result;
  return new Promise<JavisPermissionSetupResult>((resolveSetup, reject) => {
    queuedSetup = { sequence, version, result, canDeliver, resolve: resolveSetup, reject };
    startSetupWorker();
  });
}

export async function resetJavisPermissions(canDeliver: () => boolean = () => true): Promise<JavisPermissionStatus> {
  if (process.platform !== 'darwin') throw new JavisError('unsupported_platform', 'macOS TCC grants are unavailable on this platform');
  if (!canDeliver()) throw new JavisError('action_timeout', 'Permission request was cancelled before delivery');
  if (resetInFlight) return resetInFlight;
  const version = ++epoch;
  cachedStatus = undefined;
  lastLaunchAt = -Infinity;
  activeStatus?.abort();
  statusInFlight = undefined;
  cancelQueuedSetup();
  const pending = serialized(async () => {
    assertPermissionDelivery(version, canDeliver);
    const plist = join(appPath(), 'Contents/Info.plist');
    const identity = (await command('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist])).trim();
    if (identity !== bundleId) throw new JavisError('access_denied', 'Installed app bundle ID does not match Javis');
    assertPermissionDelivery(version, canDeliver);
    await closeSetupHelpers(appPath());
    assertPermissionDelivery(version, canDeliver);
    await command('/usr/bin/tccutil', ['reset', 'Accessibility', bundleId]);
    await command('/usr/bin/tccutil', ['reset', 'ScreenCapture', bundleId]);
    assertPermissionDelivery(version, canDeliver);
    const controller = new AbortController();
    activeStatus = controller;
    try { return await pacedStatus(version, controller); }
    finally { if (activeStatus === controller) activeStatus = undefined; }
  });
  resetInFlight = pending.finally(() => { resetInFlight = undefined; });
  return resetInFlight;
}
