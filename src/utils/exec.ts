import { exec as execSync } from 'child_process';
import { promisify } from 'util';

export const exec = promisify(execSync);

export async function runCommand(cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
  const result = await exec(cmd, {
    cwd: cwd || process.cwd(),
    encoding: 'utf-8',
  });
  return result;
}

export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\"'\"'")}'`;
}
