/**
 * Rendering comment text as GitHub Flavored Markdown.
 *
 * Comments come from other users, so the output must be safe to put in the page
 * with `v-html`. markdown-it escapes everything it does not produce itself: raw
 * HTML is off, and its link validation drops `javascript:`, `vbscript:`, `file:`
 * and `data:` URLs. Images are not rendered (they would fetch from wherever the
 * author chose each time the comment is read, and the sidebar's CSP blocks other
 * origins anyway); `![alt](url)` shows as a link to the image instead.
 *
 * GFM features: tables, strikethrough, autolinked URLs, task lists, and line
 * breaks kept as typed, as in GitHub comments.
 */
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

const md = new MarkdownIt('default', { html: false, linkify: true, breaks: true });
md.disable(['image']);

// The sidebar is framed: a link followed in place would replace the sidebar.
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx]!;
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer nofollow');
  return self.renderToken(tokens, idx, options);
};

const TASK = /^\[([ xX])\][ \t]/;

/** GFM task list items: `- [ ]` and `- [x]` become disabled checkboxes. */
md.core.ruler.after('inline', 'task-lists', (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]!;
    if (
      inline.type !== 'inline' ||
      tokens[i - 1]!.type !== 'paragraph_open' ||
      tokens[i - 2]!.type !== 'list_item_open'
    ) {
      continue;
    }
    const first = inline.children?.[0];
    const match = first?.type === 'text' ? TASK.exec(first.content) : null;
    if (!first || !match) continue;
    first.content = first.content.slice(match[0].length);
    const box: Token = new state.Token('html_inline', '', 0);
    box.content = `<input type="checkbox" class="task" disabled${match[1] === ' ' ? '' : ' checked'}> `;
    inline.children!.unshift(box);
    tokens[i - 2]!.attrJoin('class', 'task-item');
  }
});

/** The comment as HTML, safe to insert. */
export function renderMarkdown(text: string): string {
  return md.render(text);
}
