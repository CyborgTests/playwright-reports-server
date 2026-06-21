// ---------------------------------------------------------------------------
// Injected client-side script for Playwright report augmentation.
// Adds: LLM analysis buttons, inline analysis display, feedback panel,
// navigation bar linking back to the dashboard.
//
// Context variables provided by the outer <script> wrapper (html-injector.ts):
//   reportId, reportProject, isLlmEnabled
// ---------------------------------------------------------------------------

// ── Config & State ──────────────────────────────────────────────────────

// biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
const llmEnabled = typeof isLlmEnabled !== 'undefined' ? !!isLlmEnabled : true;

const inflightAnalysisFetches = new Set();
const EMPTY_HISTORY = { priorOccurrenceCount: 0, firstOccurrence: null };

let llmButtonRetryCount = 0;
const MAX_LLM_BUTTON_RETRIES = 100;

// ── Utilities ───────────────────────────────────────────────────────────

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function relativeTimeShort(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  const days = Math.floor(ms / 86_400_000);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function extractTestIdFromCurrentUrl() {
  try {
    const url = new URL(globalThis.location.href);

    if (url.hash) {
      const hashParams = new URLSearchParams(url.hash.slice(1));
      const testId = hashParams.get('testId');
      if (testId) {
        return testId;
      }
    }

    const testId = url.searchParams.get('testId');
    if (testId) {
      return testId;
    }
    return 'unknown';
  } catch (error) {
    console.warn('[Playwright LLM] Error extracting test ID from URL:', error);
    return 'unknown';
  }
}

function markdownToHtml(text) {
  if (!text) return 'No analysis available';

  // Some local models emit markdown with literal `\n` and `\t` escape
  // sequences instead of actual newlines. Detect-and-unescape only when
  // present so legitimate text containing a backslash-n is left alone.
  let html = text;
  if (/\\[ntr"]/.test(html)) {
    html = html
      .replaceAll('\\n', '\n')
      .replaceAll('\\t', '\t')
      .replaceAll('\\r', '\r')
      .replaceAll('\\"', '"');
  }

  const codeBlocks = [];
  html = html.replaceAll(/```(\w*)\n([\s\S]*?)```/g, (_, language, code) => {
    const langClass = language ? ` language-${language}` : '';
    const codeBlockHtml = `<div style="margin: 16px 0;">
      <div style="background-color: #1f2937; color: #f9fafb; padding: 16px; border-radius: 8px; overflow-x: auto; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 14px; line-height: 1.5; white-space: pre;"><code${langClass}>${code.trim()}</code></div>
    </div>`;
    codeBlocks.push(codeBlockHtml);
    return '__CODE_BLOCK__';
  });

  html = html.replaceAll(
    /^### (.*$)/gim,
    '<h3 style="margin: 16px 0 8px 0; color: var(--llm-body-text); font-size: 18px; font-weight: 600;">$1</h3>'
  );
  html = html.replaceAll(
    /^## (.*$)/gim,
    '<h2 style="margin: 20px 0 12px 0; color: var(--llm-body-text); font-size: 20px; font-weight: 600;">$1</h2>'
  );
  html = html.replaceAll(
    /^# (.*$)/gim,
    '<h1 style="margin: 24px 0 16px 0; color: var(--llm-body-text); font-size: 24px; font-weight: 700;">$1</h1>'
  );

  html = html.replaceAll(
    /\*\*(.*?)\*\*/g,
    '<strong style="font-weight: 600; color: var(--llm-body-text);">$1</strong>'
  );

  html = html.replaceAll(
    /(?<!\*)\*([^*\n]+)\*(?!\*)/g,
    '<em style="font-style: italic; color: var(--llm-muted);">$1</em>'
  );

  html = html.replaceAll(
    /`([^`\n]+)`/g,
    "<code style=\"background-color: var(--llm-code-bg); color: var(--llm-code-text); padding: 2px 6px; border-radius: 4px; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 14px;\">$1</code>"
  );

  // Markdown links: pwrs:test/... and pwrs:report/... become in-app
  // navigation; unknown pwrs: subschemes degrade to muted plain text.
  html = html.replaceAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_, rawLabel, rawUrl) => {
    const label = rawLabel.trim();
    const url = rawUrl.trim();
    const linkStyle = 'color: var(--llm-badge-text); text-decoration: underline;';
    if (url.startsWith('pwrs:test/')) {
      const target = url.slice('pwrs:test/'.length);
      const qIdx = target.indexOf('?');
      const pathPart = qIdx === -1 ? target : target.slice(0, qIdx);
      const queryStr = qIdx === -1 ? '' : target.slice(qIdx + 1);
      if (pathPart && !pathPart.includes('/')) {
        const testId = encodeURIComponent(pathPart);
        let project = '';
        if (queryStr) {
          try {
            const raw = new URLSearchParams(queryStr).get('project');
            if (raw) project = `?project=${encodeURIComponent(raw)}`;
          } catch {
            /* malformed query — drop it */
          }
        }
        return `<a href="/test/${testId}${project}" style="${linkStyle}">${label}</a>`;
      }
      return `<span style="color: var(--llm-muted);">${label}</span>`;
    }
    if (url.startsWith('pwrs:report/')) {
      const rid = encodeURIComponent(url.slice('pwrs:report/'.length));
      return `<a href="/report/${rid}" style="${linkStyle}">${label}</a>`;
    }
    if (url.startsWith('pwrs:')) {
      return `<span style="color: var(--llm-muted);">${label}</span>`;
    }
    const safeUrl = url.replace(/"/g, '&quot;');
    return `<a href="${safeUrl}" target="_blank" rel="noopener" style="${linkStyle}">${label}</a>`;
  });

  html = html.replaceAll(
    /^\* (.+)$/gim,
    '<li style="margin: 4px 0; color: var(--llm-body-text);">• $1</li>'
  );

  html = html.replaceAll(
    /(<li.*<\/li>)/gs,
    '<ul style="margin: 12px 0; padding-left: 20px; list-style: none;">$1</ul>'
  );

  html = html.replaceAll(
    /^\d+\. (.+)$/gim,
    '<li style="margin: 4px 0; color: var(--llm-body-text);">$1</li>'
  );

  const paragraphs = html.split('\n\n');
  html = paragraphs
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) return '';
      if (
        trimmed.startsWith('<h1>') ||
        trimmed.startsWith('<h2>') ||
        trimmed.startsWith('<h3>') ||
        trimmed.startsWith('<ul>') ||
        trimmed.startsWith('<li>') ||
        trimmed.startsWith('__CODE_BLOCK__')
      ) {
        return trimmed;
      }
      return `<p style="margin: 12px 0;">${trimmed}</p>`;
    })
    .join('\n');

  let codeBlockIndex = 0;
  html = html.replaceAll('__CODE_BLOCK__', () => {
    return codeBlocks[codeBlockIndex++];
  });

  html = html.replaceAll(/(<p[^>]*>)(.*?)(<\/p>)/g, (_, openTag, content, closeTag) => {
    content = content.replaceAll('\n', '<br>');
    return openTag + content + closeTag;
  });

  return html;
}

// ── DOM Discovery ───────────────────────────────────────────────────────

function findErrorsChipBody() {
  const headers = document.querySelectorAll('.chip-header');
  for (const header of headers) {
    if (header.textContent?.trim().startsWith('Errors')) {
      const chip = header.closest('.chip');
      const body = chip?.querySelector('.chip-body');
      if (body) return body;
    }
  }
  return null;
}

function findNativeCopyPromptButton(errorsBody) {
  for (const btn of errorsBody.querySelectorAll('button.button')) {
    if (btn.closest('.llm-btn-wrapper')) continue; // skip our own buttons
    const text = btn.textContent?.trim();
    if (text === 'Copy prompt' || text === 'Copied') return btn;
  }
  return null;
}

function positionAnchorClearOfNative(wrapper, errorsBody) {
  const nativeContainer = findNativeCopyPromptButton(errorsBody)?.parentElement;
  if (nativeContainer && nativeContainer !== wrapper) {
    const width = Math.ceil(nativeContainer.getBoundingClientRect().width);
    wrapper.style.right = `${width > 0 ? 16 + width + 8 : 140}px`;
  } else {
    wrapper.style.right = '16px';
  }
}

function getOrCreateAnchor() {
  const errorsBody = findErrorsChipBody();

  let wrapper = document.querySelector('.llm-btn-wrapper');
  if (!wrapper) {
    if (!errorsBody) return null;
    wrapper = document.createElement('div');
    wrapper.style.cssText = 'position: absolute; right: 16px; padding: 10px; z-index: 1;';
    wrapper.className = 'llm-btn-wrapper';
    errorsBody.style.position = 'relative';
    errorsBody.insertBefore(wrapper, errorsBody.firstChild);
  }

  if (errorsBody) positionAnchorClearOfNative(wrapper, errorsBody);
  return wrapper;
}

function findErrorsSection(anchor) {
  const chipBody = anchor.closest('.chip-body');
  if (chipBody) return chipBody;
  return anchor.closest('.test-result-error') || anchor.parentNode?.parentNode || anchor.parentNode;
}

function whenErrorsSectionReady(anchor, cb, timeoutMs = 2000) {
  const section = findErrorsSection(anchor);
  if (section) {
    cb(section);
    return;
  }
  const start = Date.now();
  const obs = new MutationObserver(() => {
    if (Date.now() - start > timeoutMs) {
      obs.disconnect();
      return;
    }
    const s = findErrorsSection(anchor);
    if (s) {
      obs.disconnect();
      cb(s);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), timeoutMs + 100);
}

// ── API ─────────────────────────────────────────────────────────────────

async function fetchFeedback(testId, rid) {
  const url = `/api/llm/feedback?testId=${encodeURIComponent(testId)}&reportId=${encodeURIComponent(rid)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.data ?? null;
  } catch {
    return null;
  }
}

async function fetchRelatedFeedback(testId, rid) {
  const url = `/api/llm/feedback/related?testId=${encodeURIComponent(testId)}&reportId=${encodeURIComponent(rid)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.data) ? j.data : [];
  } catch {
    return [];
  }
}

async function fetchTestHistory(testId, rid) {
  const url = `/api/llm/test-history?testId=${encodeURIComponent(testId)}&reportId=${encodeURIComponent(rid)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return EMPTY_HISTORY;
    const j = await r.json();
    return j?.data ?? EMPTY_HISTORY;
  } catch {
    return EMPTY_HISTORY;
  }
}

async function fetchAnalysisStatus(testId, rid) {
  try {
    const r = await fetch(
      `/api/test-analysis/${encodeURIComponent(testId)}?reportId=${encodeURIComponent(rid)}`
    );
    if (!r.ok) return { exists: false, reused: false };
    const j = await r.json();
    const data = j?.data;
    return {
      exists: !!(j?.success && data?.analysis),
      reused: !!data?.reusedFromAnalysisId,
    };
  } catch {
    return { exists: false, reused: false };
  }
}

async function copyLLMPromptToClipboard(btn, testId) {
  // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
  const rid = typeof reportId !== 'undefined' ? reportId : '';
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.style.opacity = '0.6';
  const restore = (label) => {
    btn.textContent = label;
    setTimeout(() => {
      btn.textContent = originalLabel;
      btn.disabled = false;
      btn.style.opacity = '';
    }, 1500);
  };
  try {
    const r = await fetch(
      `/api/test-analysis/${encodeURIComponent(testId)}/prompt?reportId=${encodeURIComponent(rid)}&refresh=1`
    );
    if (r.status === 404) {
      restore('Not available');
      return;
    }
    if (!r.ok) {
      restore('Copy failed');
      return;
    }
    const payload = await r.json();
    const prompt = payload?.data?.prompt;
    if (!prompt) {
      restore('Not available');
      return;
    }
    await navigator.clipboard.writeText(prompt);
    restore('Copied');
  } catch {
    restore('Copy failed');
  }
}

// ── Navigation Bar ──────────────────────────────────────────────────────

const ARROW_LEFT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>';
const EXTERNAL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

function injectNavBar() {
  if (document.getElementById('pwrs-nav-bar')) return;

  const bar = document.createElement('div');
  bar.id = 'pwrs-nav-bar';
  bar.className = 'pwrs-nav-bar';

  // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
  const rid = typeof reportId !== 'undefined' ? reportId : '';
  if (rid) {
    const reportBtn = document.createElement('a');
    reportBtn.className = 'pwrs-nav-btn';
    reportBtn.href = `/report/${encodeURIComponent(rid)}`;
    reportBtn.innerHTML = `${ARROW_LEFT_SVG} Report Details`;
    reportBtn.title = 'View this report in the dashboard';
    bar.appendChild(reportBtn);
  }

  const headerView = document.querySelector('.header-view');
  if (headerView) {
    headerView.prepend(bar);
  } else {
    document.body.prepend(bar);
  }
}

function updateTestDetailsButton() {
  const bar = document.getElementById('pwrs-nav-bar');
  if (!bar) return;

  const testId = extractTestIdFromCurrentUrl();
  const existing = bar.querySelector('.pwrs-test-details-btn');

  if (!testId || testId === 'unknown') {
    if (existing) existing.remove();
    return;
  }

  // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
  const project = typeof reportProject !== 'undefined' ? reportProject : '';
  const href = `/test/${encodeURIComponent(testId)}?project=${encodeURIComponent(project)}`;

  if (existing) {
    existing.href = href;
    return;
  }

  const btn = document.createElement('a');
  btn.className = 'pwrs-nav-btn pwrs-test-details-btn';
  btn.href = href;
  btn.innerHTML = `${EXTERNAL_SVG} Test Details`;
  btn.title = 'View test history and analytics';
  bar.appendChild(btn);
}

// ── Inline Analysis ─────────────────────────────────────────────────────

function setFullCopyBtnVisibility(visible) {
  const btn = document.querySelector('.llm-copy-prompt-full-btn');
  if (btn) btn.style.display = visible ? '' : 'none';
}

function checkForPrecomputedAnalysis(testId, anchor, askBtn) {
  // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
  const rid = typeof reportId !== 'undefined' ? reportId : '';
  const key = `${testId}::${rid}`;
  if (inflightAnalysisFetches.has(key)) return;
  inflightAnalysisFetches.add(key);
  fetch(`/api/test-analysis/${encodeURIComponent(testId)}?reportId=${encodeURIComponent(rid)}`)
    .then((response) => {
      if (!response.ok) return null;
      return response.json();
    })
    .then((data) => {
      if (data?.success && data?.data?.analysis) {
        renderInlineAnalysis(data.data, anchor, askBtn, testId);
      } else if (data?.success && data?.pending && llmEnabled) {
        renderLoadingAnalysis(testId, rid, anchor, askBtn);
      }
    })
    .catch(() => {
      /* no section injected on failure */
    })
    .finally(() => {
      inflightAnalysisFetches.delete(key);
    });
}

function renderLoadingAnalysis(testId, rid, anchor, askBtn) {
  if (document.getElementById('llm-inline-analysis')) return;

  whenErrorsSectionReady(anchor, (errorsSection) => {
    if (document.getElementById('llm-inline-analysis')) return;
    renderLoadingInto(testId, rid, anchor, askBtn, errorsSection);
  });
}

function renderLoadingInto(testId, rid, anchor, askBtn, errorsSection, taskId = null) {
  if (askBtn) askBtn.style.display = 'none';
  setFullCopyBtnVisibility(false);

  const section = document.createElement('div');
  section.id = 'llm-inline-analysis';
  section.dataset.loading = '1';
  section.innerHTML = `
    <div class="llm-inline-header">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="llm-title">LLM Analysis</span>
        <span class="llm-model">in progress…</span>
      </div>
    </div>
    <div class="llm-inline-body">
      <div style="display: flex; align-items: center; gap: 12px; padding: 4px 0;">
        <div class="llm-spinner" style="
          width: 18px;
          height: 18px;
          border: 2px solid var(--llm-btn-border);
          border-top: 2px solid var(--llm-border);
          border-radius: 50%;
          animation: llm-spin 1s linear infinite;
        "></div>
        <span style="color: var(--llm-muted); font-size: 13px;">
          LLM analysis is already queued / running. This panel will update automagically.
        </span>
      </div>
    </div>
  `;
  errorsSection.parentNode.insertBefore(section, errorsSection);

  // SSE subscription with poll fallback for task progress.
  let cleanup = null;
  const settle = () => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    fetch(`/api/test-analysis/${encodeURIComponent(testId)}?reportId=${encodeURIComponent(rid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success && data?.data?.analysis) {
          section.remove();
          renderInlineAnalysis(data.data, anchor, askBtn, testId);
        } else {
          section.remove();
          setFullCopyBtnVisibility(true);
          if (askBtn) askBtn.style.display = '';
        }
      })
      .catch(() => {
        section.remove();
        setFullCopyBtnVisibility(true);
        if (askBtn) askBtn.style.display = '';
      });
  };

  const subscribe = (taskId) => {
    if (typeof EventSource === 'undefined') {
      pollFallback();
      return;
    }
    const es = new EventSource(`/api/llm/task-progress/${encodeURIComponent(taskId)}`);
    let receivedAny = false;
    es.addEventListener('update', (evt) => {
      receivedAny = true;
      try {
        const row = JSON.parse(evt.data);
        if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') {
          settle();
        }
      } catch {
        // ignore malformed payloads
      }
    });
    es.onerror = () => {
      es.close();
      if (!receivedAny) pollFallback();
    };
    cleanup = () => es.close();
  };

  let attempts = 0;
  const MAX_ATTEMPTS = 60;
  const pollFallback = () => {
    const tick = () => {
      attempts++;
      fetch(`/api/test-analysis/${encodeURIComponent(testId)}?reportId=${encodeURIComponent(rid)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.success && data?.data?.analysis) {
            section.remove();
            renderInlineAnalysis(data.data, anchor, askBtn, testId);
            return;
          }
          if (data?.success && data?.pending && attempts < MAX_ATTEMPTS) {
            setTimeout(tick, 3000);
            return;
          }
          section.remove();
          setFullCopyBtnVisibility(true);
          if (askBtn) askBtn.style.display = '';
        })
        .catch(() => {
          if (attempts < MAX_ATTEMPTS) setTimeout(tick, 3000);
        });
    };
    setTimeout(tick, 3000);
  };

  if (taskId) {
    subscribe(taskId);
  } else {
    fetch(`/api/test-analysis/${encodeURIComponent(testId)}?reportId=${encodeURIComponent(rid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success && data?.data?.analysis) {
          section.remove();
          renderInlineAnalysis(data.data, anchor, askBtn, testId);
          return;
        }
        if (data?.success && data?.pending?.taskId) {
          subscribe(data.pending.taskId);
          return;
        }
        pollFallback();
      })
      .catch(() => {
        pollFallback();
      });
  }
}

function renderInlineAnalysis(analysisData, anchor, askBtn, testIdOverride) {
  const existing = document.getElementById('llm-inline-analysis');
  if (existing) existing.remove();

  whenErrorsSectionReady(anchor, (errorsSection) => {
    document.getElementById('llm-inline-analysis')?.remove();

    if (askBtn) askBtn.style.display = 'none';

    const categoryBadge = analysisData.category
      ? `<span class="llm-category-badge">${analysisData.category}</span>`
      : '';
    const reusedBadge = analysisData.reusedFromAnalysisId
      ? `<span class="llm-reused-badge" title="Same error signature as a previous run — analysis was reused without calling the LLM. Click Retry to force a fresh analysis.">♻ Reused</span>`
      : '';

    const retryBtnHtml = llmEnabled ? '<button class="llm-retry-btn">Retry</button>' : '';
    const resolvedTestId = testIdOverride || analysisData.testId || '';
    const copyPromptBtnHtml =
      resolvedTestId && !analysisData.reusedFromAnalysisId
        ? '<button class="llm-copy-prompt-btn" title="Copy the LLM prompt (with test history and feedback) for this test.">Copy prompt with history</button>'
        : '';

    const section = document.createElement('div');
    section.id = 'llm-inline-analysis';
    section.innerHTML = `
      <div class="llm-inline-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="llm-title">LLM Analysis</span>
          ${categoryBadge}
          ${reusedBadge}
          <span class="llm-model">${analysisData.model || ''}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          ${copyPromptBtnHtml}
          ${retryBtnHtml}
        </div>
      </div>
      <div class="llm-inline-body">
        ${markdownToHtml(analysisData.analysis)}
      </div>
    `;

    errorsSection.parentNode.insertBefore(section, errorsSection);
    setFullCopyBtnVisibility(false);

    if (resolvedTestId) {
      // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
      const rid = typeof reportId !== 'undefined' ? reportId : '';
      refreshFeedbackStaleIndicator(resolvedTestId, rid);
    }

    const retryBtn = section.querySelector('.llm-retry-btn');
    if (retryBtn) {
      retryBtn.onclick = () => {
        section.remove();
        setFullCopyBtnVisibility(true);
        if (askBtn) {
          askBtn.style.display = '';
          askBtn.click();
        }
      };
    }

    const copyPromptBtn = section.querySelector('.llm-copy-prompt-btn');
    if (copyPromptBtn) {
      copyPromptBtn.onclick = () => copyLLMPromptToClipboard(copyPromptBtn, resolvedTestId);
    }
  });
}

// ── Feedback Panel ──────────────────────────────────────────────────────

function feedbackBody(testId, rid, extra) {
  return JSON.stringify({ testId: testId, reportId: rid, ...extra });
}

function reportLinkLabel(reportId, displayNumber, title) {
  const safeTitle = typeof title === 'string' && title ? escapeHtml(title) : '';
  if (typeof displayNumber === 'number' && displayNumber > 0) {
    return safeTitle ? `#${displayNumber} ${safeTitle}` : `#${displayNumber}`;
  }
  if (safeTitle) return safeTitle;
  return `report ${reportId.slice(0, 8)}`;
}

async function injectFeedbackPanel(testId, rid, anchor) {
  if (!testId || !rid || testId === 'unknown') return;
  if (document.getElementById('llm-feedback-panel')) return;

  const [feedback, related, history, analysisStatus] = await Promise.all([
    fetchFeedback(testId, rid),
    fetchRelatedFeedback(testId, rid),
    fetchTestHistory(testId, rid),
    fetchAnalysisStatus(testId, rid),
  ]);
  renderFeedbackPanel({
    feedback,
    related,
    history,
    analysisStatus,
    testId,
    reportId: rid,
    anchor,
  });
}

function renderFeedbackPanel({
  feedback,
  related,
  history,
  analysisStatus,
  testId,
  reportId: rid,
  anchor,
}) {
  let panel = document.getElementById('llm-feedback-panel');
  const expanded = panel?.dataset.expanded === '1';
  const draftSnapshot = panel?.querySelector('.llm-feedback-textarea')?.value;
  const relatedEntries = Array.isArray(related)
    ? related
    : panel?.__relatedCache
      ? panel.__relatedCache
      : [];
  const historyData = history ?? panel?.__historyCache ?? EMPTY_HISTORY;
  const status = analysisStatus ?? panel?.__analysisStatusCache ?? { exists: false, reused: false };

  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'llm-feedback-panel';
    const insertionPoint = findErrorsSection(anchor);
    if (insertionPoint?.parentNode) {
      insertionPoint.parentNode.insertBefore(panel, insertionPoint);
    } else {
      anchor.parentNode?.parentNode?.appendChild(panel);
    }
  }
  panel.__relatedCache = relatedEntries;
  panel.__historyCache = historyData;
  panel.__analysisStatusCache = status;

  const stateLabel = feedback
    ? `(updated ${relativeTimeShort(feedback.updatedAt)})`
    : 'No feedback yet';

  const originIsCurrent = feedback?.reportId === rid;
  const originLine =
    feedback?.reportId && feedback?.createdAt && !originIsCurrent
      ? `<div class="llm-feedback-origin">
          First attached in
          <a href="/report/${feedback.reportId}" target="_blank" rel="noopener">${reportLinkLabel(feedback.reportId, feedback.reportDisplayNumber, feedback.reportTitle)}</a>
          — ${relativeTimeShort(feedback.createdAt)}
        </div>`
      : '';

  const firstOccIsCurrent = historyData.firstOccurrence?.reportId === rid;
  const firstFoundInline =
    historyData.firstOccurrence && !firstOccIsCurrent
      ? `<span class="llm-feedback-firstfound">
          First found in
          <a href="/report/${historyData.firstOccurrence.reportId}" target="_blank" rel="noopener">${reportLinkLabel(historyData.firstOccurrence.reportId, historyData.firstOccurrence.displayNumber, historyData.firstOccurrence.title)}</a>
          — ${relativeTimeShort(historyData.firstOccurrence.createdAt)}
        </span>`
      : '';

  const priorCount = historyData.priorOccurrenceCount ?? 0;
  const failureChip =
    priorCount === 0
      ? `<span class="llm-feedback-new-error" title="This exact failure has not been seen in prior runs of this test">🆕 New error</span>`
      : `<span class="llm-feedback-related-chip" title="This failure signature has been seen in ${priorCount} prior run${priorCount === 1 ? '' : 's'} of this test">🔁 ${priorCount} prior occurrence${priorCount === 1 ? '' : 's'}</span>`;
  const relatedCount = relatedEntries.length;
  const relatedChipHtml =
    relatedCount > 0
      ? `<span class="llm-feedback-related-chip" title="Same test has feedback in ${relatedCount} other project${relatedCount === 1 ? '' : 's'}" data-related-jump="1">🔗 ${relatedCount} other project${relatedCount === 1 ? '' : 's'}</span>`
      : '';

  const reusedChip = status.reused
    ? `<span class="llm-feedback-reused-chip" title="The analysis shown for this test was reused from a previous run with the same error signature — it wasn't generated for this specific failure. Click Retry on the analysis to force a fresh one.">♻ Reused</span>`
    : '';
  const relatedSection =
    relatedCount > 0
      ? `<div class="llm-feedback-related">
          <div class="llm-feedback-related-title">Same test in other projects:</div>
          <ul class="llm-feedback-related-list">
            ${relatedEntries
              .map((e) => {
                const sigText = e.errorSignatureMatchesCurrent
                  ? 'matching error'
                  : 'different error';
                const sigClass = e.errorSignatureMatchesCurrent ? 'match' : 'differ';
                const reportLink = e.feedback?.reportId
                  ? `<a href="/report/${e.feedback.reportId}" target="_blank" rel="noopener">${e.project}</a>`
                  : `<span>${e.project}</span>`;
                return `<li>
                  ${reportLink}
                  <span class="llm-feedback-sig ${sigClass}">${sigText}</span>
                  <span class="llm-feedback-related-time">${relativeTimeShort(e.feedback?.updatedAt ?? new Date().toISOString())}</span>
                </li>`;
              })
              .join('')}
          </ul>
        </div>`
      : '';

  panel.innerHTML = `
    <div class="llm-feedback-header">
      <span class="llm-feedback-icon">💬</span>
      <span class="llm-feedback-title">Feedback</span>
      <span class="llm-feedback-state">${stateLabel}</span>
      ${failureChip}
      ${firstFoundInline}
      ${reusedChip}
      ${relatedChipHtml}
      <span class="llm-feedback-stale" hidden>⚠ Latest feedback not included in analysis</span>
      <button class="llm-feedback-toggle" type="button">${expanded ? 'View' : 'Edit'}</button>
    </div>
    <div class="llm-feedback-body" ${expanded ? '' : 'hidden'}>
      ${originLine}
      ${relatedSection}
      <textarea class="llm-feedback-textarea" placeholder="Add a note for the LLM. Will be included in future analyses for this test in this project."></textarea>
      <div class="llm-feedback-actions">
        <button class="llm-feedback-save" type="button">Save</button>
        <button class="llm-feedback-delete" type="button" ${feedback ? '' : 'hidden'}>Delete</button>
        <span class="llm-feedback-status"></span>
      </div>
    </div>
  `;

  panel.querySelectorAll('.llm-feedback-related-chip').forEach((chip) => {
    chip.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const bodyEl = panel.querySelector('.llm-feedback-body');
      const toggle = panel.querySelector('.llm-feedback-toggle');
      if (bodyEl?.hasAttribute('hidden')) {
        bodyEl.removeAttribute('hidden');
        if (toggle) toggle.textContent = 'View';
        panel.dataset.expanded = '1';
      }
      if (chip.getAttribute('data-related-jump') === '1') {
        panel.querySelector('.llm-feedback-related')?.scrollIntoView({ block: 'nearest' });
      }
    });
  });

  const textarea = panel.querySelector('.llm-feedback-textarea');
  const toggleBtn = panel.querySelector('.llm-feedback-toggle');
  const body = panel.querySelector('.llm-feedback-body');
  const saveBtn = panel.querySelector('.llm-feedback-save');
  const deleteBtn = panel.querySelector('.llm-feedback-delete');
  const statusEl = panel.querySelector('.llm-feedback-status');

  textarea.value = draftSnapshot ?? feedback?.comment ?? '';
  panel.dataset.expanded = expanded ? '1' : '0';

  const savedComment = feedback?.comment ?? '';
  function refreshSaveDisabled() {
    const trimmed = textarea.value.trim();
    saveBtn.disabled = !trimmed || trimmed === savedComment;
  }
  refreshSaveDisabled();
  textarea.addEventListener('input', refreshSaveDisabled);

  toggleBtn.onclick = () => {
    const nowExpanded = body.hasAttribute('hidden');
    if (nowExpanded) {
      body.removeAttribute('hidden');
      toggleBtn.textContent = 'View';
      panel.dataset.expanded = '1';
    } else {
      body.setAttribute('hidden', '');
      toggleBtn.textContent = 'Edit';
      panel.dataset.expanded = '0';
    }
  };

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = `llm-feedback-status${kind ? ` llm-feedback-status-${kind}` : ''}`;
  }

  saveBtn.onclick = async () => {
    const comment = textarea.value.trim();
    if (!comment) {
      setStatus('Comment is empty', 'error');
      return;
    }
    saveBtn.disabled = true;
    setStatus('Saving…');
    try {
      const r = await fetch('/api/llm/feedback', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: feedbackBody(testId, rid, { comment }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error || 'Save failed');
      setStatus('Saved', 'ok');
      if (panel) panel.dataset.expanded = '0';
      renderFeedbackPanel({ feedback: j.data, testId, reportId: rid, anchor });
    } catch (err) {
      setStatus(err.message || 'Save failed', 'error');
      saveBtn.disabled = false;
    }
  };

  deleteBtn.onclick = async () => {
    deleteBtn.disabled = true;
    setStatus('Deleting…');
    try {
      const r = await fetch('/api/llm/feedback', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: feedbackBody(testId, rid),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error || 'Delete failed');
      setStatus('Deleted', 'ok');
      renderFeedbackPanel({ feedback: null, testId, reportId: rid, anchor });
    } catch (err) {
      setStatus(err.message || 'Delete failed', 'error');
    } finally {
      deleteBtn.disabled = false;
    }
  };

  refreshFeedbackStaleIndicator(testId, rid);
}

async function refreshFeedbackStaleIndicator(testId, rid) {
  const panel = document.getElementById('llm-feedback-panel');
  if (!panel) return;
  const staleEl = panel.querySelector('.llm-feedback-stale');
  if (!staleEl) return;

  const [feedback, analysis] = await Promise.all([
    fetchFeedback(testId, rid),
    fetch(`/api/test-analysis/${encodeURIComponent(testId)}?reportId=${encodeURIComponent(rid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  const feedbackAt = feedback?.updatedAt ? new Date(feedback.updatedAt).getTime() : 0;
  const analysisAt = (() => {
    const t = analysis?.data?.updatedAt || analysis?.data?.createdAt;
    return t ? new Date(t).getTime() : 0;
  })();

  const stale = feedbackAt > 0 && analysisAt > 0 && feedbackAt > analysisAt;
  if (stale) staleEl.removeAttribute('hidden');
  else staleEl.setAttribute('hidden', '');
}

// ── Button Injection ────────────────────────────────────────────────────

function injectAskLLMButton() {
  const anchor = getOrCreateAnchor();
  if (!anchor) return false;

  // Read-only mode: surface previously-generated analyses without the Ask button.
  if (!llmEnabled) {
    const currentTestId = extractTestIdFromCurrentUrl();
    if (!currentTestId || currentTestId === 'unknown') return;
    if (!document.getElementById('llm-inline-analysis')) {
      checkForPrecomputedAnalysis(currentTestId, anchor, null);
    }
    return true;
  }

  const existingAskBtn = anchor.querySelector('.llm-ask-btn');
  if (existingAskBtn) {
    const currentTestId = extractTestIdFromCurrentUrl();
    if (!currentTestId || currentTestId === 'unknown') return;

    const testChanged = existingAskBtn.dataset.testId !== currentTestId;
    const inlineMissing = !document.getElementById('llm-inline-analysis');
    const feedbackMissing = !document.getElementById('llm-feedback-panel');

    if (testChanged) {
      existingAskBtn.dataset.testId = currentTestId;
      existingAskBtn.style.display = '';
      document.getElementById('llm-inline-analysis')?.remove();
      document.getElementById('llm-feedback-panel')?.remove();
      setFullCopyBtnVisibility(true);
      checkForPrecomputedAnalysis(currentTestId, anchor, existingAskBtn);
      // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
      injectFeedbackPanel(currentTestId, reportId, anchor);
      return;
    }

    if (inlineMissing) {
      checkForPrecomputedAnalysis(currentTestId, anchor, existingAskBtn);
    }
    if (feedbackMissing) {
      // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
      injectFeedbackPanel(currentTestId, reportId, anchor);
    }
    return;
  }

  const askBtn = document.createElement('button');
  askBtn.textContent = 'Ask LLM';
  askBtn.className = 'button llm-ask-btn';
  askBtn.style.minWidth = '100px';
  askBtn.style.marginLeft = '8px';

  askBtn.onclick = async () => {
    const currentTestId = extractTestIdFromCurrentUrl();
    // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
    const rid = reportId;

    askBtn.style.display = 'none';
    setFullCopyBtnVisibility(false);

    try {
      const response = await fetch('/api/llm/analyze-failed-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testId: currentTestId, reportId: rid }),
      });
      const j = await response.json();
      if (!response.ok || !j?.success || !j?.data?.taskId) {
        throw new Error(j?.error || 'Failed to enqueue analysis task');
      }
      whenErrorsSectionReady(anchor, (errorsSection) => {
        if (document.getElementById('llm-inline-analysis')) return;
        renderLoadingInto(currentTestId, rid, anchor, askBtn, errorsSection, j.data.taskId);
      });
    } catch (error) {
      console.error('[Playwright LLM] Analysis error:', error);
      askBtn.style.display = '';
      setFullCopyBtnVisibility(true);
    }
  };

  anchor.appendChild(askBtn);

  const fullCopyBtn = document.createElement('button');
  fullCopyBtn.textContent = 'Copy prompt with history';
  fullCopyBtn.className = 'button llm-copy-prompt-full-btn';
  fullCopyBtn.style.marginLeft = '6px';
  fullCopyBtn.title =
    'Copy the LLM prompt (with test history and feedback) that would be sent for this test+report right now.';
  fullCopyBtn.onclick = () => {
    const currentTestId = extractTestIdFromCurrentUrl();
    if (!currentTestId || currentTestId === 'unknown') return;
    copyLLMPromptToClipboard(fullCopyBtn, currentTestId);
  };
  anchor.appendChild(fullCopyBtn);

  const currentTestId = extractTestIdFromCurrentUrl();
  if (currentTestId && currentTestId !== 'unknown') {
    askBtn.dataset.testId = currentTestId;
    checkForPrecomputedAnalysis(currentTestId, anchor, askBtn);
    // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
    injectFeedbackPanel(currentTestId, reportId, anchor);
  }

  return true;
}

// ── Initialization ──────────────────────────────────────────────────────

function tryInjectAskLLMButton() {
  // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
  if (typeof reportId !== 'undefined' && reportId === 'trace') return;

  injectNavBar();
  updateTestDetailsButton();

  const injected = injectAskLLMButton();

  if (!injected && llmButtonRetryCount < MAX_LLM_BUTTON_RETRIES) {
    llmButtonRetryCount++;
    setTimeout(tryInjectAskLLMButton, 50);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', tryInjectAskLLMButton);
  document.addEventListener('click', (event) => {
    if (event?.target?.className?.includes('test-file-title')) {
      tryInjectAskLLMButton();
    }
  });
} else {
  setTimeout(tryInjectAskLLMButton, 50);
}

globalThis.addEventListener?.('hashchange', () => {
  llmButtonRetryCount = 0;
  setTimeout(tryInjectAskLLMButton, 50);
});

// Guardian observer: Playwright re-renders the errors DOM on retry-tab
// clicks (no URL change). Re-inject our nodes when they get removed.
(() => {
  if (typeof MutationObserver === 'undefined' || !document.body) return;

  let pending = null;
  const schedule = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      if (!findErrorsChipBody()) return;

      const askBtn = document.querySelector('.llm-btn-wrapper .llm-ask-btn');

      if (!llmEnabled) {
        if (!document.getElementById('llm-inline-analysis')) {
          injectAskLLMButton();
        }
        return;
      }
      const needsAskBtn = !askBtn;
      const needsInline = askBtn && !document.getElementById('llm-inline-analysis');
      const needsFeedback = askBtn && !document.getElementById('llm-feedback-panel');
      if (needsAskBtn || needsInline || needsFeedback) {
        injectAskLLMButton();
      }
    }, 150);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
})();
