import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DetailSignature } from './DetailSignature';

const render = (props: Partial<Parameters<typeof DetailSignature>[0]>) =>
  renderToStaticMarkup(
    <DetailSignature
      argumentHint={null}
      components={[]}
      files={[]}
      fullName="o/r"
      meta={{}}
      slug="x"
      type="skill"
      {...props}
    />,
  );
const uncoloured = (html: string) => html.replace(/<\/?span[^>]*>/g, '');

describe('DetailSignature', () => {
  it('blanks a credential in an MCP command, as the Setup section does', () => {
    const meta = {
      servers: [
        {
          name: 'db',
          transport: 'stdio',
          command: 'npx',
          args: ['--api-key', 'sk-invented1234567'],
        },
      ],
    };
    const html = uncoloured(render({ type: 'mcp_server', meta }));
    expect(html).not.toContain('sk-invented1234567');
    expect(html).toContain('&lt;redacted&gt;');
  });

  it('blanks a credential in a hook command', () => {
    const meta = {
      handlers: [{ event: 'PreToolUse', command: 'API_KEY=sk-invented1234567 ./guard.sh' }],
    };
    const html = uncoloured(render({ type: 'hook', meta }));
    expect(html).not.toContain('sk-invented1234567');
    expect(html).toContain('PreToolUse');
  });

  it('says a command as it is typed', () => {
    const html = render({ type: 'command', slug: 'fix', argumentHint: ['issue'] });
    expect(html).toContain('/fix');
    expect(html).toContain('[issue]');
  });

  it('draws nothing where the file declares nothing, rather than an empty band', () => {
    for (const type of ['mcp_server', 'hook', 'skill', 'plugin', 'catalog']) {
      expect(render({ type })).toBe('');
    }
  });

  it('says how many it left out', () => {
    const files = Array.from({ length: 9 }, (_, i) => ({ path: `d/f${i}`, kind: 'file' }));
    expect(render({ type: 'skill', files })).toContain('and 3 more files');
  });
});
