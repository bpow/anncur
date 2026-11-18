import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders emphasis, code and lists', () => {
    const html = renderMarkdown('**bold** _it_ `x`\n\n- a\n- b');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<code>x</code>');
    expect(html).toContain('<li>a</li>');
  });

  it('keeps single line breaks', () => {
    expect(renderMarkdown('one\ntwo')).toBe('<p>one<br>\ntwo</p>\n');
  });

  it('renders GFM tables and strikethrough', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |\n\n~~gone~~');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('<s>gone</s>');
  });

  it('renders task lists as disabled checkboxes', () => {
    const html = renderMarkdown('- [ ] todo\n- [x] done\n- [y] not a task');
    expect(html).toContain(
      '<li class="task-item"><input type="checkbox" class="task" disabled> todo</li>',
    );
    expect(html).toContain('<input type="checkbox" class="task" disabled checked> done');
    expect(html).toContain('<li>[y] not a task</li>');
  });

  it('autolinks URLs and opens links in a new tab', () => {
    const html = renderMarkdown('see https://example.org/x and [doc](https://example.org/d)');
    expect(html).toContain(
      '<a href="https://example.org/x" target="_blank" rel="noopener noreferrer nofollow">',
    );
    expect(html).toContain(
      '<a href="https://example.org/d" target="_blank" rel="noopener noreferrer nofollow">doc</a>',
    );
  });

  it('escapes raw HTML', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> <script>alert(1)</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops dangerous link schemes', () => {
    const html = renderMarkdown('[x](javascript:alert(1)) [y](data:text/html,hi)');
    expect(html).not.toContain('href');
  });

  it('does not render images', () => {
    const html = renderMarkdown('![alt](https://tracker.example/p.png)');
    expect(html).not.toContain('<img');
  });

  it('does not treat task markers in text as checkboxes', () => {
    expect(renderMarkdown('[ ] not in a list')).not.toContain('<input');
    expect(renderMarkdown('- <input> [ ] x')).not.toContain('<input');
  });
});
