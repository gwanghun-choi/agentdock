import { describe, expect, it } from 'vitest';
import { REDACTED, redactArgs, redactSecrets } from './redact';

// Every value below is invented for this file; none was ever a credential.
describe('redactSecrets', () => {
  it.each([
    [
      'https://mcp.example.invalid/sse?api_key=abc123&region=eu',
      `https://mcp.example.invalid/sse?api_key=${REDACTED}&region=eu`,
    ],
    [
      'postgres://app:hunter2@db.example.invalid:5432/x',
      `postgres://app:${REDACTED}@db.example.invalid:5432/x`,
    ],
    [
      'curl -H "Authorization: Bearer abcdefgh12345678" https://x.invalid',
      `curl -H "Authorization: Bearer ${REDACTED}" https://x.invalid`,
    ],
    ['API_KEY=s3cretvalue ./run.sh', `API_KEY=${REDACTED} ./run.sh`],
    ['./check.sh --token=abc --verbose', `./check.sh --token=${REDACTED} --verbose`],
    ['./check.sh --password hunter2 --verbose', `./check.sh --password ${REDACTED} --verbose`],
    ['echo ghp_abcdefghijklmnopqrstuvwxyz0123456789', `echo ${REDACTED}`],
    ['use sk-ant-FAKEFAKEFAKEFAKEFAKE00 here', `use ${REDACTED} here`],
  ])('blanks %s', (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it.each([
    'npx -y @scope/server --stdio',
    'https://example.invalid/mcp',
    'uv run server.py --port 8080',
    `TOKEN=\${GITHUB_TOKEN} ./run.sh`,
    '--api-key $API_KEY',
    'jq -r .tool_input.file_path',
    'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/check.py',
  ])('leaves %s as written', (input) => {
    expect(redactSecrets(input)).toBe(input);
  });

  it('keeps markup as characters for React to escape, adding none', () => {
    expect(redactSecrets('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('redactArgs', () => {
  it('blanks the element after a sensitive flag, and only that one', () => {
    expect(redactArgs(['-y', 'srv', '--api-key', 'abc123', '--port', '80'])).toEqual([
      '-y',
      'srv',
      '--api-key',
      REDACTED,
      '--port',
      '80',
    ]);
  });

  it('keeps a variable reference and a following flag, and passes non-strings through', () => {
    expect(redactArgs(['--token', `\${TOKEN}`, '--secret', '--verbose', 3])).toEqual([
      '--token',
      `\${TOKEN}`,
      '--secret',
      '--verbose',
      3,
    ]);
  });
});
