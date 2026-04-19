import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import type { ParsedTestUrl } from './url-parser.js';

export async function injectTestAnalysis(source: string, testUrl: ParsedTestUrl): Promise<string> {
  if (!testUrl.reportId) {
    return source;
  }

  try {
    const html = await injectCopyPromptToWindow(source);
    const dom = new JSDOM(html);
    const document = dom.window.document;
    await injectClientSideScript(document, testUrl);
    console.log(
      `[html-injector] Successfully injected client-side script for testId: ${testUrl.reportId}`
    );
    return dom.serialize();
  } catch (error) {
    console.error('[html-injector] Error injecting HTML:', error);
    return source;
  }
}

async function injectClientSideScript(document: any, testUrl: ParsedTestUrl): Promise<void> {
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --llm-border: #10b981;
      --llm-header-bg: #f0fdf4;
      --llm-header-border: #bbf7d0;
      --llm-header-text: #166534;
      --llm-body-bg: #ffffff;
      --llm-body-text: #1f2937;
      --llm-muted: #6b7280;
      --llm-badge-bg: #dbeafe;
      --llm-badge-text: #1e40af;
      --llm-btn-bg: #ffffff;
      --llm-btn-border: #d1d5db;
      --llm-btn-text: #374151;
      --llm-code-bg: #f3f4f6;
      --llm-code-text: #1f2937;
      --llm-modal-bg: #ffffff;
      --llm-modal-overlay: rgba(0,0,0,0.5);
      --llm-stream-bg: #f9fafb;
      --llm-thinking-bg: #fefce8;
      --llm-thinking-border: #eab308;
      --llm-thinking-text: #854d0e;
      --llm-error-bg: #fef2f2;
      --llm-error-border: #ef4444;
      --llm-error-text: #dc2626;
    }

    .dark-mode, [data-theme="dark"] {
      --llm-border: #065f46;
      --llm-header-bg: #052e16;
      --llm-header-border: #065f46;
      --llm-header-text: #86efac;
      --llm-body-bg: #111827;
      --llm-body-text: #e5e7eb;
      --llm-muted: #9ca3af;
      --llm-badge-bg: #1e3a5f;
      --llm-badge-text: #93c5fd;
      --llm-btn-bg: #1f2937;
      --llm-btn-border: #374151;
      --llm-btn-text: #e5e7eb;
      --llm-code-bg: #1f2937;
      --llm-code-text: #e5e7eb;
      --llm-modal-bg: #1f2937;
      --llm-modal-overlay: rgba(0,0,0,0.7);
      --llm-stream-bg: #1f2937;
      --llm-thinking-bg: #422006;
      --llm-thinking-border: #a16207;
      --llm-thinking-text: #fef08a;
      --llm-error-bg: #450a0a;
      --llm-error-border: #991b1b;
      --llm-error-text: #fca5a5;
    }

    @media (prefers-color-scheme: dark) {
      :root:not(.light-mode) {
        --llm-border: #065f46;
        --llm-header-bg: #052e16;
        --llm-header-border: #065f46;
        --llm-header-text: #86efac;
        --llm-body-bg: #111827;
        --llm-body-text: #e5e7eb;
        --llm-muted: #9ca3af;
        --llm-badge-bg: #1e3a5f;
        --llm-badge-text: #93c5fd;
        --llm-btn-bg: #1f2937;
        --llm-btn-border: #374151;
        --llm-btn-text: #e5e7eb;
        --llm-code-bg: #1f2937;
        --llm-code-text: #e5e7eb;
        --llm-modal-bg: #1f2937;
        --llm-modal-overlay: rgba(0,0,0,0.7);
        --llm-stream-bg: #1f2937;
        --llm-thinking-bg: #422006;
        --llm-thinking-border: #a16207;
        --llm-thinking-text: #fef08a;
        --llm-error-bg: #450a0a;
        --llm-error-border: #991b1b;
        --llm-error-text: #fca5a5;
      }
    }

    #llm-inline-analysis {
      margin: 12px 0;
      border: 1px solid var(--llm-border);
      border-radius: 8px;
      overflow: hidden;
    }

    .llm-inline-header {
      background: var(--llm-header-bg);
      padding: 10px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--llm-header-border);
    }

    .llm-inline-header .llm-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--llm-header-text);
    }

    .llm-inline-header .llm-category-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      background: var(--llm-badge-bg);
      color: var(--llm-badge-text);
      font-weight: 600;
    }

    .llm-inline-header .llm-model {
      font-size: 11px;
      color: var(--llm-muted);
    }

    .llm-inline-body {
      padding: 14px 16px;
      font-size: 13px;
      line-height: 1.6;
      color: var(--llm-body-text);
      background: var(--llm-body-bg);
    }

    .llm-retry-btn {
      padding: 4px 10px;
      font-size: 11px;
      border: 1px solid var(--llm-btn-border);
      border-radius: 4px;
      background: var(--llm-btn-bg);
      cursor: pointer;
      color: var(--llm-btn-text);
    }

    .llm-retry-btn:hover { opacity: 0.8; }
    `;
  document.head.appendChild(style);

  const script = document.createElement('script');
  script.textContent = `
    const reportId = '${testUrl.reportId}';
    ${await fs.readFile(new URL('./llmButton.js', import.meta.url), 'utf-8')}`;
  document.body.appendChild(script);
}

async function injectCopyPromptToWindow(html: string): Promise<string> {
  try {
    const getPromptVariable = new RegExp(/await navigator.clipboard.writeText\((.*?)\)/);
    const promptVariable = getPromptVariable.exec(html);
    const promptVariableName = promptVariable?.at(1)?.trim();
    if (promptVariableName) {
      const addToWindow = `window.currentPrompt=${promptVariableName}`;
      const copyToClipboard = 'await navigator.clipboard.writeText';
      return html.replace(copyToClipboard, `${addToWindow};${copyToClipboard}`);
    }
    return html;
  } catch (_) {
    return html;
  }
}
