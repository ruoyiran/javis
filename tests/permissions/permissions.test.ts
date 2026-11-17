import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeFile, access, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const launch = vi.hoisted(() => vi.fn());
const reap = vi.hoisted(() => vi.fn(async (_command: string) => {}));
const wait = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: launch }));
vi.mock('../../src/runtime/helper-reaping.js', () => ({ reapHelper: reap }));
vi.mock('node:timers/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:timers/promises')>();
  wait.mockImplementation(original.setTimeout);
  return { ...original, setTimeout: wait };
});
let permissions: typeof import('../../src/permissions.js');

beforeEach(async () => { vi.resetModules(); permissions = await import('../../src/permissions.js'); });

afterEach(async () => {
  permissions.cancelJavisPermissionOperations();
  vi.unstubAllEnvs(); vi.restoreAllMocks(); launch.mockReset(); reap.mockReset(); reap.mockImplementation(async () => {});
  wait.mockReset();
  wait.mockImplementation((await vi.importActual<typeof import('node:timers/promises')>('node:timers/promises')).setTimeout);
});

function mockPermissionCommands(accessibility = 'not-granted', screenshots = 'not-granted'): void {
  launch.mockImplementation((command, args, _options, callback) => {
    if (command === '/usr/bin/plutil') return callback(null, 'com.royran.javis\n', '');
    if (command !== '/usr/bin/open' || !args.includes('--permission-status-file')) return callback(null, '', '');
    void writeFile(args.at(-1), JSON.stringify({ accessibility, screenshots })).then(() => callback(null, '', ''));
  });
}

function advancePermissionClock(): void {
  let tick = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (tick += 6000));
}

function holdPermissionPacing(): { started: Promise<void>; release: () => void } {
  let started!: () => void;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { started = resolve; });
  wait.mockImplementationOnce((_milliseconds, _value, { signal }) => new Promise<void>((resolve, reject) => {
    release = resolve;
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    started();
  }));
  return { started: pending, release: () => release() };
}

it('launches the app for passive status, uses a private result directory, and cleans up', async () => {
  vi.stubEnv('JAVIS_APP_PATH', '/tmp/Javis Test.app');
  let resultPath = '';
  launch.mockImplementation((_command, args, _options, callback) => {
    resultPath = args[args.length - 1];
    void (async () => {
      expect((await stat(new URL('.', `file://${resultPath}`))).mode & 0o777).toBe(0o700);
      await writeFile(resultPath, JSON.stringify({ accessibility: 'granted', screenshots: 'not-granted' }));
      callback(null, '', '');
    })();
  });
  await expect(permissions.readJavisPermissionStatus()).resolves.toEqual({ platform: 'darwin', permissions: [
    { id: 'accessibility', status: 'granted' }, { id: 'screenshots', status: 'not-granted' },
  ] });
  expect(launch.mock.calls[0].slice(0, 2)).toEqual(['/usr/bin/open', ['-g', '-n', '/tmp/Javis Test.app', '--args', '--permission-status-file', resultPath]]);
  await expect(access(resultPath)).rejects.toThrow();
});

it('opens setup through the signed app with the requested permission', async () => {
  vi.stubEnv('JAVIS_APP_PATH', '/tmp/Javis.app');
  advancePermissionClock();
  mockPermissionCommands('granted', 'granted');
  await expect(permissions.openJavisPermissions('screenshots')).resolves.toEqual({
    platform: 'darwin', helperAppPath: '/tmp/Javis.app', permissionId: 'screenshots',
    openedSettings: true, launchedHelper: true,
    permissions: [{ id: 'accessibility', status: 'granted' }, { id: 'screenshots', status: 'granted' }],
    nextStep: null,
  });
  expect(launch.mock.calls.find(([, args]) => args.includes('--permission'))?.slice(0, 2)).toEqual(['/usr/bin/open', ['-n', '/tmp/Javis.app', '--args', '--permission', 'screenshots']]);
});

it('replaces only exact permission setup helper commands before opening new setup', async () => {
  vi.stubEnv('JAVIS_APP_PATH', '/tmp/Javis Test.app');
  advancePermissionClock();
  const events: string[] = [];
  reap.mockImplementation(async command => { events.push(command); });
  launch.mockImplementation((_command, args, _options, callback) => {
    if (args.includes('--permission-status-file')) {
      void writeFile(args.at(-1), JSON.stringify({ accessibility: 'not-granted', screenshots: 'not-granted' })).then(() => callback(null, '', ''));
      return;
    }
    events.push('opened new setup');
    callback(null, '', '');
  });
  await permissions.openJavisPermissions('screenshots');
  expect(events).toEqual([
    '/tmp/Javis Test.app/Contents/MacOS/javis-helper --permissions',
    '/tmp/Javis Test.app/Contents/MacOS/javis-helper --permission accessibility',
    '/tmp/Javis Test.app/Contents/MacOS/javis-helper --permission screenshots',
    'opened new setup',
  ]);
});

it('reset closes only setup helpers after identity verification and before resetting grants', async () => {
  vi.stubEnv('JAVIS_APP_PATH', '/tmp/Javis.app');
  const events: string[] = [];
  reap.mockImplementation(async command => { events.push(command); });
  launch.mockImplementation((command, args, _options, callback) => {
    if (command === '/usr/bin/plutil') { events.push('verified identity'); return callback(null, 'com.royran.javis\n', ''); }
    if (command === '/usr/bin/tccutil') { events.push(args[1]); return callback(null, '', ''); }
    void writeFile(args.at(-1), JSON.stringify({ accessibility: 'not-granted', screenshots: 'not-granted' })).then(() => callback(null, '', ''));
  });
  await permissions.resetJavisPermissions();
  expect(events).toEqual([
    'verified identity',
    '/tmp/Javis.app/Contents/MacOS/javis-helper --permissions',
    '/tmp/Javis.app/Contents/MacOS/javis-helper --permission accessibility',
    '/tmp/Javis.app/Contents/MacOS/javis-helper --permission screenshots',
    'Accessibility', 'ScreenCapture',
  ]);
});

it('rechecks caller cancellation after setup helper cleanup before opening UI', async () => {
  advancePermissionClock();
  mockPermissionCommands();
  let allowed = true;
  reap.mockImplementationOnce(async () => { allowed = false; });
  await expect(permissions.openJavisPermissions('accessibility', () => allowed)).rejects.toMatchObject({ code: 'action_timeout' });
  expect(launch.mock.calls.some(([, args]) => args.includes('--permission'))).toBe(false);
});

it('paces the next helper from actual launch time after slow setup cleanup', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const delays: number[] = [];
  wait.mockImplementation(async milliseconds => { delays.push(milliseconds); now += milliseconds; });
  mockPermissionCommands();
  reap.mockImplementation(async () => { now += 1000; });
  await permissions.openJavisPermissions('accessibility');
  expect(now).toBe(8000);
  await permissions.readJavisPermissionStatus();
  expect(delays).toEqual([5000, 5000]);
});

it('supersedes a setup when a newer request arrives during existing-helper cleanup', async () => {
  advancePermissionClock();
  mockPermissionCommands();
  let started!: () => void;
  let release!: () => void;
  const cleanupStarted = new Promise<void>(resolve => { started = resolve; });
  reap.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; started(); }));
  const older = permissions.openJavisPermissions('accessibility');
  await cleanupStarted;
  const latest = permissions.openJavisPermissions('screenshots');
  release();
  await expect(older).resolves.toMatchObject({ launchedHelper: false, launchSuperseded: true });
  await expect(latest).resolves.toMatchObject({ permissionId: 'screenshots', launchedHelper: true });
  expect(launch.mock.calls.filter(([, args]) => args.includes('--permission')).map(([, args]) => args.slice(-2))).toEqual([['--permission', 'screenshots']]);
});

it('rejects malformed helper output and cleans its result directory', async () => {
  let resultPath = '';
  launch.mockImplementation((_command, args, _options, callback) => {
    resultPath = args.at(-1);
    void writeFile(resultPath, '{}').then(() => callback(null, '', ''));
  });
  await expect(permissions.readJavisPermissionStatus()).rejects.toThrow('Invalid Javis permission status');
  await expect(access(resultPath)).rejects.toThrow();
});

it('cleans up when the app cannot launch', async () => {
  let resultPath = '';
  launch.mockImplementation((_command, args, _options, callback) => {
    resultPath = args.at(-1);
    callback(new Error('Application unavailable'));
  });
  await expect(permissions.readJavisPermissionStatus()).rejects.toThrow('Application unavailable');
  await expect(access(new URL('.', `file://${resultPath}`))).rejects.toThrow();
});

it('opens the complete setup when no permission is selected', async () => {
  vi.stubEnv('JAVIS_APP_PATH', '/tmp/Javis.app');
  advancePermissionClock();
  mockPermissionCommands();
  await expect(permissions.openJavisPermissions()).resolves.toEqual({
    platform: 'darwin', helperAppPath: '/tmp/Javis.app', permissionId: null,
    openedSettings: false, launchedHelper: true,
    permissions: [{ id: 'accessibility', status: 'not-granted' }, { id: 'screenshots', status: 'not-granted' }],
    nextStep: 'Grant Accessibility to Javis in System Settings, then retry get-app-state.',
  });
  expect(launch.mock.calls.find(([, args]) => args.includes('--permissions'))?.slice(0, 2)).toEqual(['/usr/bin/open', ['-n', '/tmp/Javis.app', '--args', '--permissions']]);
});

it('checks completed setup without opening native UI', async () => {
  vi.stubEnv('JAVIS_APP_PATH', '/tmp/Javis.app');
  mockPermissionCommands('granted', 'granted');
  await expect(permissions.openJavisPermissions()).resolves.toEqual({
    platform: 'darwin', helperAppPath: '/tmp/Javis.app', permissionId: null,
    openedSettings: false, launchedHelper: false,
    permissions: [{ id: 'accessibility', status: 'granted' }, { id: 'screenshots', status: 'granted' }],
    nextStep: null,
  });
  expect(launch.mock.calls.some(([, args]) => args.includes('--permissions'))).toBe(false);
});

it('reports unsupported setup on nonmac platforms without launching a helper', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
  try {
    await expect(permissions.openJavisPermissions('screenshots')).resolves.toEqual({
      platform: 'linux', helperAppPath: null, permissionId: 'screenshots',
      openedSettings: false, launchedHelper: false,
      permissions: [{ id: 'accessibility', status: 'unsupported' }, { id: 'screenshots', status: 'unsupported' }],
      nextStep: null,
    });
    expect(launch).not.toHaveBeenCalled();
  } finally { Object.defineProperty(process, 'platform', descriptor); }
});

it('launches only the latest setup waiting for the five-second pacing window', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  mockPermissionCommands();
  await permissions.readJavisPermissionStatus();
  const pacing = holdPermissionPacing();
  const older = permissions.openJavisPermissions('accessibility');
  await pacing.started;
  const latest = permissions.openJavisPermissions('screenshots');
  await expect(older).resolves.toMatchObject({ permissionId: 'accessibility', launchedHelper: false, openedSettings: false, launchSuperseded: true });
  expect(launch.mock.calls.some(([, args]) => args.includes('--permission'))).toBe(false);
  now = 5000;
  pacing.release();
  await expect(latest).resolves.toMatchObject({ permissionId: 'screenshots', launchedHelper: true, openedSettings: true });
  expect(launch.mock.calls.filter(([, args]) => args.includes('--permission')).map(([, args]) => args.slice(-2))).toEqual([['--permission', 'screenshots']]);
});

it('supersedes a paced setup when the newer request is waiting for a fresh status probe', async () => {
  let now = 0;
  let advancing = false;
  vi.spyOn(performance, 'now').mockImplementation(() => advancing ? (now += 6000) : now);
  mockPermissionCommands();
  await permissions.readJavisPermissionStatus();
  const pacing = holdPermissionPacing();
  const older = permissions.openJavisPermissions('accessibility');
  await pacing.started;
  now = 6000;
  const latest = permissions.openJavisPermissions('screenshots');
  advancing = true;
  pacing.release();
  const olderResult = await older;
  await expect(latest).resolves.toMatchObject({ permissionId: 'screenshots', launchedHelper: true });
  expect(olderResult).toMatchObject({ launchedHelper: false, launchSuperseded: true });
  expect(launch.mock.calls.filter(([, args]) => args.includes('--permission')).map(([, args]) => args.slice(-2))).toEqual([['--permission', 'screenshots']]);
});

it('cancels a paced setup before delivery when its caller disconnects', async () => {
  let now = 0;
  let allowed = true;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  mockPermissionCommands();
  await permissions.readJavisPermissionStatus();
  const pacing = holdPermissionPacing();
  const pending = permissions.openJavisPermissions('accessibility', () => allowed);
  await pacing.started;
  allowed = false;
  now = 5000;
  pacing.release();
  await expect(pending).rejects.toMatchObject({ code: 'action_timeout' });
  expect(launch.mock.calls.some(([, args]) => args.includes('--permission'))).toBe(false);
});

it('reset cancels a paced setup and returns fresh status without opening UI', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  mockPermissionCommands();
  await permissions.readJavisPermissionStatus();
  const pacing = holdPermissionPacing();
  const pending = permissions.openJavisPermissions('screenshots');
  const cancelled = expect(pending).rejects.toMatchObject({ code: 'action_timeout' });
  await pacing.started;
  await expect(permissions.resetJavisPermissions()).resolves.toMatchObject({ permissions: [{ id: 'accessibility', status: 'not-granted' }, { id: 'screenshots', status: 'not-granted' }] });
  await cancelled;
  expect(launch.mock.calls.some(([, args]) => args.includes('--permission'))).toBe(false);
  expect(launch.mock.calls.filter(([command]) => command === '/usr/bin/tccutil').map(([, args]) => args[1])).toEqual(['Accessibility', 'ScreenCapture']);
});

it('coalesces simultaneous status reads into one helper probe', async () => {
  let probes = 0;
  launch.mockImplementation((_command, args, _options, callback) => {
    probes++;
    void writeFile(args.at(-1), JSON.stringify({ accessibility: 'granted', screenshots: 'granted' })).then(() => callback(null, '', ''));
  });
  const [first, second] = await Promise.all([permissions.readJavisPermissionStatus(), permissions.readJavisPermissionStatus()]);
  expect(first).toEqual(second);
  expect(probes).toBe(1);
});

it('reuses a granted status for at least one second to avoid repeated TCC helper launches', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let launches = 0;
  launch.mockImplementation((_command, args, _options, callback) => {
    launches++;
    void writeFile(args.at(-1), JSON.stringify({ accessibility: 'granted', screenshots: 'granted' })).then(() => callback(null, '', ''));
  });
  await permissions.readJavisPermissionStatus();
  now = 1000;
  await permissions.readJavisPermissionStatus();
  expect(launches).toBe(1);
});

it('refreshes status after the short cache expires', async () => {
  let tick = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (tick += 6000));
  let probes = 0;
  launch.mockImplementation((_command, args, _options, callback) => {
    probes++;
    const status = probes === 1 ? 'granted' : 'not-granted';
    void writeFile(args.at(-1), JSON.stringify({ accessibility: status, screenshots: status })).then(() => callback(null, '', ''));
  });
  expect((await permissions.readJavisPermissionStatus()).permissions[0].status).toBe('granted');
  expect((await permissions.readJavisPermissionStatus()).permissions[0].status).toBe('not-granted');
  expect(probes).toBe(2);
});

it('invalidates a cached grant and probes again after resetting both TCC services', async () => {
  let probes = 0;
  launch.mockImplementation((command, args, _options, callback) => {
    if (command === '/usr/bin/plutil') return callback(null, 'com.royran.javis\n', '');
    if (command === '/usr/bin/tccutil') return callback(null, '', '');
    probes++;
    const status = probes === 1 ? 'granted' : 'not-granted';
    void writeFile(args.at(-1), JSON.stringify({ accessibility: status, screenshots: status })).then(() => callback(null, '', ''));
  });
  expect((await permissions.readJavisPermissionStatus()).permissions[0].status).toBe('granted');
  expect((await permissions.readJavisPermissionStatus()).permissions[0].status).toBe('granted');
  expect((await permissions.resetJavisPermissions()).permissions[0].status).toBe('not-granted');
  expect(probes).toBe(2);
  expect(launch.mock.calls.filter(([command]) => command === '/usr/bin/tccutil').map(([, args]) => args)).toEqual([
    ['reset', 'Accessibility', 'com.royran.javis'], ['reset', 'ScreenCapture', 'com.royran.javis'],
  ]);
});

it('cancels an in-flight status probe before resetting grants', async () => {
  let started!: () => void;
  const probeStarted = new Promise<void>((resolve) => { started = resolve; });
  let probes = 0;
  launch.mockImplementation((command, args, _options, callback) => {
    if (command === '/usr/bin/plutil') return callback(null, 'com.royran.javis\n', '');
    if (command === '/usr/bin/tccutil') return callback(null, '', '');
    probes++;
    if (probes === 1) { started(); return callback(null, '', ''); }
    void writeFile(args.at(-1), JSON.stringify({ accessibility: 'not-granted', screenshots: 'not-granted' })).then(() => callback(null, '', ''));
  });
  const pending = permissions.readJavisPermissionStatus();
  const cancelled = expect(pending).rejects.toMatchObject({ code: 'action_timeout' });
  await probeStarted;
  expect((await permissions.resetJavisPermissions()).permissions[0].status).toBe('not-granted');
  await cancelled;
  expect(probes).toBe(2);
  expect(reap.mock.calls.filter(([command]) => command.includes('--permission-status-file'))).toHaveLength(1);
  expect(reap).toHaveBeenCalledTimes(4);
});

it('cancels a queued status probe when reset starts first', async () => {
  let probes = 0;
  launch.mockImplementation((command, args, _options, callback) => {
    if (command === '/usr/bin/plutil') return callback(null, 'com.royran.javis\n', '');
    if (command === '/usr/bin/tccutil') return callback(null, '', '');
    probes++;
    void writeFile(args.at(-1), JSON.stringify({ accessibility: 'not-granted', screenshots: 'not-granted' })).then(() => callback(null, '', ''));
  });
  const queued = permissions.readJavisPermissionStatus();
  const cancelled = expect(queued).rejects.toMatchObject({ code: 'action_timeout' });
  const reset = permissions.resetJavisPermissions();
  await cancelled;
  await reset;
  expect(probes).toBe(1);
});

it('reaps a status helper whose result file never appears', async () => {
  let tick = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (tick += 6000));
  launch.mockImplementation((_command, _args, _options, callback) => callback(null, '', ''));
  await expect(permissions.readJavisPermissionStatus()).rejects.toThrow('Timed out waiting for Javis permission status');
  expect(reap).toHaveBeenCalledTimes(1);
});

it('reports macOS permission controls as unsupported on other platforms', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
  try {
    expect(await permissions.readJavisPermissionStatus()).toEqual({ platform: 'linux', permissions: [
      { id: 'accessibility', status: 'unsupported' }, { id: 'screenshots', status: 'unsupported' },
    ] });
    expect(launch).not.toHaveBeenCalled();
  } finally { Object.defineProperty(process, 'platform', descriptor); }
});

it('cancels a queued setup before it opens UI when daemon shutdown begins', async () => {
  let started!: () => void;
  const statusStarted = new Promise<void>(resolve => { started = resolve; });
  launch.mockImplementation((_command, args, _options, callback) => {
    if (args.includes('--permission-status-file')) { started(); callback(null, '', ''); return; }
    callback(null, '', '');
  });
  const status = permissions.readJavisPermissionStatus();
  const rejectedStatus = expect(status).rejects.toMatchObject({ code: 'action_timeout' });
  await statusStarted;
  const opened = permissions.openJavisPermissions();
  const rejectedOpen = expect(opened).rejects.toMatchObject({ code: 'action_timeout' });
  permissions.cancelJavisPermissionOperations();
  await rejectedStatus;
  await rejectedOpen;
  expect(launch.mock.calls.some(([, args]) => args.includes('--permissions'))).toBe(false);
});

it('does not reset grants when its requester has disconnected before dispatch', async () => {
  launch.mockImplementation((_command, _args, _options, callback) => callback(null, '', ''));
  await expect(permissions.resetJavisPermissions(() => false)).rejects.toMatchObject({ code: 'action_timeout' });
  expect(launch).not.toHaveBeenCalled();
});

it('finishes both TCC resets after the first reset was committed', async () => {
  let allowed = true;
  const services: string[] = [];
  launch.mockImplementation((command, args, _options, callback) => {
    if (command === '/usr/bin/plutil') return callback(null, 'com.royran.javis\n', '');
    if (command === '/usr/bin/tccutil') {
      services.push(args[1]);
      if (args[1] === 'Accessibility') allowed = false;
      return callback(null, '', '');
    }
    void writeFile(args.at(-1), JSON.stringify({ accessibility: 'not-granted', screenshots: 'not-granted' }))
      .then(() => callback(null, '', ''));
  });
  await expect(permissions.resetJavisPermissions(() => allowed)).rejects.toMatchObject({ code: 'action_timeout' });
  expect(services).toEqual(['Accessibility', 'ScreenCapture']);
});
