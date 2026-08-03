import { homedir } from 'os';
import { isAbsolute, relative, resolve } from 'path';

export function getHomeDirectory(): string {
  const home = homedir();
  if (!home || !isAbsolute(home)) {
    throw new Error('Unable to determine a valid home directory');
  }
  return home;
}

export function assertPathWithinBase(basePath: string, targetPath: string, label: string): string {
  const resolvedBase = resolve(basePath);
  const resolvedTarget = resolve(resolvedBase, targetPath);
  const rel = relative(resolvedBase, resolvedTarget);

  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolvedTarget;
  }

  throw new Error(`${label} must stay within ${resolvedBase}`);
}

export function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export function escapeYamlDoubleQuoted(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export function validateXUsername(username: string | undefined): string {
  if (!username || !/^[A-Za-z0-9_]{1,15}$/.test(username)) {
    throw new Error('Invalid X username in API response');
  }
  return username;
}

export function validateXPostId(id: string): string {
  if (!/^\d+$/.test(id)) {
    throw new Error('Invalid X post id in API response');
  }
  return id;
}
