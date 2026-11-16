import { afterEach, expect, it, vi } from 'vitest';
import { writeFile, access, stat } from 'node:fs/promises';

const launch = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: launch }));
import { readJavisPermissionStatus, openJavisPermissions } from '../../src/permissions.js';

afterEach(() => { vi.unstubAllEnvs(); launch.mockReset(); });

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
  await expect(readJavisPermissionStatus()).resolves.toEqual({ platform: 'darwin', permissions: [
    { id: 'accessibility', status: 'granted' }, { id: 'screenshots', status: 'not-granted' },
  ] });
  expect(launch.mock.calls[0].slice(0, 2)).toEqual(['/usr/bin/open', ['-n', '/tmp/Javis Test.app', '--args', '--permission-status-file', resultPath]]);
  await expect(access(resultPath)).rejects.toThrow();
});

it('opens setup through the signed app with the requested permission', async () => {
  vi.stubEnv('JAVIS_APP_PATH', '/tmp/Javis.app');
  launch.mockImplementation((_command, _args, _options, callback) => callback(null, '', ''));
  await openJavisPermissions('screenshots');
  expect(launch.mock.calls[0].slice(0, 2)).toEqual(['/usr/bin/open', ['-n', '/tmp/Javis.app', '--args', '--permission', 'screenshots']]);
});

it('rejects malformed helper output and cleans its result directory', async () => {
  let resultPath = '';
  launch.mockImplementation((_command, args, _options, callback) => {
    resultPath = args.at(-1);
    void writeFile(resultPath, '{}').then(() => callback(null, '', ''));
  });
  await expect(readJavisPermissionStatus()).rejects.toThrow('Invalid Javis permission status');
  await expect(access(resultPath)).rejects.toThrow();
});

it('cleans up when the app cannot launch', async () => {
  let resultPath = '';
  launch.mockImplementation((_command, args, _options, callback) => {
    resultPath = args.at(-1);
    callback(new Error('Application unavailable'));
  });
  await expect(readJavisPermissionStatus()).rejects.toThrow('Application unavailable');
  await expect(access(new URL('.', `file://${resultPath}`))).rejects.toThrow();
});

it('opens the complete setup when no permission is selected', async () => {
  vi.stubEnv('JAVIS_APP_PATH', '/tmp/Javis.app');
  launch.mockImplementation((_command, _args, _options, callback) => callback(null, '', ''));
  await openJavisPermissions();
  expect(launch.mock.calls[0].slice(0, 2)).toEqual(['/usr/bin/open', ['-n', '/tmp/Javis.app', '--args', '--permissions']]);
});
