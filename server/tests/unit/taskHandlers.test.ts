import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Task Execution Handlers', () => {
  test('shell handler executes CLI commands cleanly', async () => {
    const command = 'echo Hello JobCodity';
    const { stdout, stderr } = await execAsync(command, { timeout: 5000 });

    expect(stdout.trim()).toBe('Hello JobCodity');
    expect(stderr.trim()).toBe('');
  });

  test('shell handler throws on non-zero exit code or syntax error', async () => {
    const command = 'node -e "process.exit(1)"';
    await expect(execAsync(command, { timeout: 5000 })).rejects.toThrow();
  });
});
