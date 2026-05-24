// biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
const llmEnabled = typeof isLlmEnabled !== 'undefined' ? !!isLlmEnabled : true;

function injectAskLLMButton() {
  // Only Playwright's native "Copy prompt" button — exclude our own
  // .llm-copy-prompt-btn (which also contains the text "Copy prompt") so the
  // injected widget can't pose as the anchor for sibling-button placement.
  const copyPromptButtons = Array.from(document.querySelectorAll('button')).filter(
    (btn) =>
      btn.textContent?.includes('Copy prompt') &&
      !btn.classList.contains('llm-copy-prompt-btn') &&
      !btn.classList.contains('llm-copy-prompt-full-btn')
  );

  if (!copyPromptButtons.length) {
    return false;
  }

  const copyPromptButton = copyPromptButtons.at(0);

  // Read-only mode: LLM is disabled but we still want to surface previously-
  // generated analyses. Skip the Ask LLM button and the feedback panel.
  // and only render an inline analysis when one is already persisted for this test.
  if (!llmEnabled) {
    const currentTestId = extractTestIdFromCurrentUrl();
    if (!currentTestId || currentTestId === 'unknown') return;
    if (!document.getElementById('llm-inline-analysis')) {
      checkForPrecomputedAnalysis(currentTestId, copyPromptButton, null);
    }
    return true;
  }

  const existingAskBtn = copyPromptButton.parentNode?.querySelector('.llm-ask-btn');
  if (existingAskBtn) {
    // Same button host as before — but the user may have navigated to a different test.
    // Re-check analysis for the (possibly new) testId so we don't show stale state.
    const currentTestId = extractTestIdFromCurrentUrl();
    if (!currentTestId || currentTestId === 'unknown') return;

    const testChanged = existingAskBtn.dataset.testId !== currentTestId;
    const inlineMissing = !document.getElementById('llm-inline-analysis');
    const feedbackMissing = !document.getElementById('llm-feedback-panel');

    if (testChanged) {
      // User navigated to a different test (hash change, file-tree click). Reset
      // the stored testId and discard any leftover panels for the previous test.
      existingAskBtn.dataset.testId = currentTestId;
      existingAskBtn.style.display = '';
      document.getElementById('llm-inline-analysis')?.remove();
      document.getElementById('llm-feedback-panel')?.remove();
      // The previous test's inline-analysis may have hidden the next-to-
      // Ask-LLM Copy prompt button; bring it back before re-checking, in
      // case the new test has no analysis yet.
      setFullCopyBtnVisibility(true);
      checkForPrecomputedAnalysis(currentTestId, copyPromptButton, existingAskBtn);
      // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
      injectFeedbackPanel(currentTestId, reportId, copyPromptButton);
      return;
    }

    // Same test, same button host — but Playwright may have just rebuilt the
    // errors section (retry-tab swap), wiping our injected nodes. Re-attach
    // whichever ones are missing. The fetches are cheap and idempotent.
    if (inlineMissing) {
      checkForPrecomputedAnalysis(currentTestId, copyPromptButton, existingAskBtn);
    }
    if (feedbackMissing) {
      // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
      injectFeedbackPanel(currentTestId, reportId, copyPromptButton);
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
      whenErrorsSectionReady(copyPromptButton, (errorsSection) => {
        if (document.getElementById('llm-inline-analysis')) return;
        renderLoadingInto(currentTestId, rid, copyPromptButton, askBtn, errorsSection, j.data.taskId);
      });
    } catch (error) {
      console.error('[Playwright LLM] Analysis error:', error);
      askBtn.style.display = '';
      setFullCopyBtnVisibility(true);
    }
  };

  copyPromptButton.parentNode?.insertBefore(askBtn, copyPromptButton.nextSibling);

  // "Copy prompt" — visible next to Ask LLM by default; hidden when an
  // inline analysis renders (the analysis-header sibling button takes over).
  // Both locations always build fresh.
  const fullCopyBtn = document.createElement('button');
  fullCopyBtn.textContent = 'Copy prompt with history';
  fullCopyBtn.className = 'button llm-copy-prompt-full-btn';
  fullCopyBtn.style.marginLeft = '6px';
  fullCopyBtn.title =
    'Copy the LLM prompt (with test history and feedback) that would be sent for this test+report right now.';
  fullCopyBtn.onclick = () => {
    const currentTestId = extractTestIdFromCurrentUrl();
    if (!currentTestId || currentTestId === 'unknown') return;
    // Always force fresh — this button surfaces the current would-be prompt.
    copyLLMPromptToClipboard(fullCopyBtn, currentTestId);
  };
  askBtn.insertAdjacentElement('afterend', fullCopyBtn);

  // Check for pre-computed LLM analysis — if found, show inline and hide Ask LLM button
  const currentTestId = extractTestIdFromCurrentUrl();
  if (currentTestId && currentTestId !== 'unknown') {
    askBtn.dataset.testId = currentTestId;
    checkForPrecomputedAnalysis(currentTestId, copyPromptButton, askBtn);
    // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
    injectFeedbackPanel(currentTestId, reportId, copyPromptButton);
  }

  return true;
}

/**
 * Show or hide the "Copy prompt" button that sits next to Ask LLM. Hidden
 * when an inline analysis is rendered (the in-analysis sibling button takes
 * over), shown otherwise.
 */
function setFullCopyBtnVisibility(visible) {
  const btn = document.querySelector('.llm-copy-prompt-full-btn');
  if (btn) btn.style.display = visible ? '' : 'none';
}

/**
 * Fetch the prompt for the current (testId, reportId), write it to the
 * clipboard, and flash a status label on `btn` for 1.5s. Always builds fresh
 * (passes `refresh=1`) so the user sees the current would-be prompt rather
 * than whatever was frozen at the last analysis. The historical verbatim
 * prompt is still reachable via the CLI's analysis-prompt endpoint.
 */
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
  // sequences instead of actual newlines (JSON-string style without the JSON
  // envelope). Detect-and-unescape only when present so legitimate text
  // containing a backslash-n is left alone. Mirrors the backend safety net.
  let html = text;
  if (/\\[ntr"]/.test(html)) {
    html = html
      .replaceAll('\\n', '\n')
      .replaceAll('\\t', '\t')
      .replaceAll('\\r', '\r')
      .replaceAll('\\"', '"');
  }

  // process code blocks first (before other transformations)
  const codeBlocks = [];
  html = html.replaceAll(/```(\w*)\n([\s\S]*?)```/g, (_, language, code) => {
    const langClass = language ? ` language-${language}` : '';
    const codeBlockHtml = `<div style="margin: 16px 0;">
      <div style="background-color: #1f2937; color: #f9fafb; padding: 16px; border-radius: 8px; overflow-x: auto; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 14px; line-height: 1.5; white-space: pre;"><code${langClass}>${code.trim()}</code></div>
    </div>`;
    codeBlocks.push(codeBlockHtml);
    return '__CODE_BLOCK__';
  });

  // headers
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

  // bold text
  html = html.replaceAll(
    /\*\*(.*?)\*\*/g,
    '<strong style="font-weight: 600; color: var(--llm-body-text);">$1</strong>'
  );

  // italic text - more specific to avoid interfering with bold
  html = html.replaceAll(
    /(?<!\*)\*([^*\n]+)\*(?!\*)/g,
    '<em style="font-style: italic; color: var(--llm-muted);">$1</em>'
  );

  // inline code (make sure not to interfere with code blocks)
  html = html.replaceAll(
    /`([^`\n]+)`/g,
    "<code style=\"background-color: var(--llm-code-bg); color: var(--llm-code-text); padding: 2px 6px; border-radius: 4px; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; font-size: 14px;\">$1</code>"
  );

  // Markdown links [label](url). pwrs:test/... and pwrs:report/... become
  // in-app navigation; other URLs become external anchors. Unknown pwrs:
  // subschemes degrade to muted plain text so a stale ref doesn't render as
  // a broken link.
  html = html.replaceAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_, rawLabel, rawUrl) => {
    const label = rawLabel.trim();
    const url = rawUrl.trim();
    const linkStyle = 'color: var(--llm-badge-text); text-decoration: underline;';
    if (url.startsWith('pwrs:test/')) {
      const target = url.slice('pwrs:test/'.length);
      const qIdx = target.indexOf('?');
      const pathPart = qIdx === -1 ? target : target.slice(0, qIdx);
      const queryStr = qIdx === -1 ? '' : target.slice(qIdx + 1);
      const slash = pathPart.indexOf('/');
      if (slash > 0 && slash < pathPart.length - 1) {
        const fileId = encodeURIComponent(pathPart.slice(0, slash));
        const testId = encodeURIComponent(pathPart.slice(slash + 1));
        // Extract project from the embedded query; fall through to a bare
        // path if absent (the test detail page will still try its default
        // lookup).
        let project = '';
        if (queryStr) {
          try {
            const raw = new URLSearchParams(queryStr).get('project');
            if (raw) project = `?project=${encodeURIComponent(raw)}`;
          } catch {
            /* malformed query — drop it */
          }
        }
        return `<a href="/test/${fileId}/${testId}${project}" style="${linkStyle}">${label}</a>`;
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

  // bullet points
  html = html.replaceAll(
    /^\* (.+)$/gim,
    '<li style="margin: 4px 0; color: var(--llm-body-text);">• $1</li>'
  );

  // wrap bullet lists
  html = html.replaceAll(
    /(<li.*<\/li>)/gs,
    '<ul style="margin: 12px 0; padding-left: 20px; list-style: none;">$1</ul>'
  );

  // numbered lists
  html = html.replaceAll(
    /^\d+\. (.+)$/gim,
    '<li style="margin: 4px 0; color: var(--llm-body-text);">$1</li>'
  );

  // process paragraphs - split by double newlines
  const paragraphs = html.split('\n\n');
  html = paragraphs
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) return '';

      // skip if it starts with HTML tags (headers, lists, etc.)
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

  // re-inject code blocks
  let codeBlockIndex = 0;
  html = html.replaceAll('__CODE_BLOCK__', () => {
    return codeBlocks[codeBlockIndex++];
  });

  // convert single newlines to <br> only within paragraphs
  html = html.replaceAll(/(<p[^>]*>)(.*?)(<\/p>)/g, (_, openTag, content, closeTag) => {
    content = content.replaceAll('\n', '<br>');
    return openTag + content + closeTag;
  });

  return html;
}

// Module-level fetch dedup. The body-level guardian observer (see bottom of
// file) can call checkForPrecomputedAnalysis on every DOM mutation that
// removes our injected nodes; without this we'd hammer /api/test-analysis.
const inflightAnalysisFetches = new Set();

function checkForPrecomputedAnalysis(testId, copyPromptButton, askBtn) {
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
        renderInlineAnalysis(data.data, copyPromptButton, askBtn, testId);
      } else if (data?.success && data?.pending && llmEnabled) {
        // Analysis is queued or processing — show a loading widget and poll until done.
        renderLoadingAnalysis(testId, rid, copyPromptButton, askBtn);
      }
    })
    .catch(() => {
      // Silently fail — no section injected
    })
    .finally(() => {
      inflightAnalysisFetches.delete(key);
    });
}

function renderLoadingAnalysis(testId, rid, copyPromptButton, askBtn) {
  // If a real analysis or another loader is already in the DOM, don't double-render.
  if (document.getElementById('llm-inline-analysis')) return;

  // Wait for the errors section if Playwright is still building the test page.
  whenErrorsSectionReady(copyPromptButton, (errorsSection) => {
    if (document.getElementById('llm-inline-analysis')) return;
    renderLoadingInto(testId, rid, copyPromptButton, askBtn, errorsSection);
  });
}

function renderLoadingInto(testId, rid, copyPromptButton, askBtn, errorsSection, taskId = null) {
  if (askBtn) askBtn.style.display = 'none';
  // The loading widget owns the on-screen affordance for inspecting state
  // while the analysis runs; hide the next-to-Ask-LLM Copy prompt button so
  // we don't show two prompt entry points at once.
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
      <style>
        @keyframes llm-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </div>
  `;
  errorsSection.parentNode.insertBefore(section, errorsSection);

  // Resolve the pending taskId once, then subscribe to the task-progress SSE
  // stream. Falls back to a 3s poll loop only if SSE is unavailable
  // (older browser, proxy stripping text/event-stream, or a connection error
  // before any update arrives).
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
          renderInlineAnalysis(data.data, copyPromptButton, askBtn, testId);
        } else {
          // Task settled without producing an analysis (cancelled/failed).
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
      // If we never got an update event, the server may not support SSE here;
      // degrade to polling so the user still sees a result.
      if (!receivedAny) pollFallback();
    };
    cleanup = () => es.close();
  };

  let attempts = 0;
  const MAX_ATTEMPTS = 60; // ~3 minutes at 3s intervals
  const pollFallback = () => {
    const tick = () => {
      attempts++;
      fetch(`/api/test-analysis/${encodeURIComponent(testId)}?reportId=${encodeURIComponent(rid)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.success && data?.data?.analysis) {
            section.remove();
            renderInlineAnalysis(data.data, copyPromptButton, askBtn, testId);
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

  // If taskId is provided, subscribe directly to it (used when we just enqueued a task).
  // Otherwise, resolve the current pending task id from the server.
  if (taskId) {
    subscribe(taskId);
  } else {
    fetch(`/api/test-analysis/${encodeURIComponent(testId)}?reportId=${encodeURIComponent(rid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success && data?.data?.analysis) {
          section.remove();
          renderInlineAnalysis(data.data, copyPromptButton, askBtn, testId);
          return;
        }
        if (data?.success && data?.pending?.taskId) {
          subscribe(data.pending.taskId);
          return;
        }
        // No pending task right now — fall back to polling in case one is
        // about to be enqueued (e.g. cascade after report-summary regenerate).
        pollFallback();
      })
      .catch(() => {
        pollFallback();
      });
  }
}

/**
 * Find the errors section in the Playwright report and inject the analysis above it.
 * The errors section is typically the container holding the "Copy prompt" button.
 */
function findErrorsSection(copyPromptButton) {
  // Walk up from the Copy prompt button to find the test result container
  let node = copyPromptButton.parentNode;
  for (let i = 0; i < 5 && node; i++) {
    // Look for a sibling or parent that is the errors area
    if (node.previousElementSibling || node.parentNode) break;
    node = node.parentNode;
  }
  // The errors area is the closest ancestor that holds error content
  // Use the grandparent of the button row as insertion point
  return (
    copyPromptButton.closest('.test-result-error') ||
    copyPromptButton.parentNode?.parentNode ||
    copyPromptButton.parentNode
  );
}

/**
 * Run `cb(section)` once the errors section is in the DOM. Resolves
 * synchronously when it's already there. Otherwise watches `document.body`
 * for up to `timeoutMs` and fires the callback the first time
 * `findErrorsSection` returns a node — fixes the race where the precomputed
 * analysis fetch resolves before Playwright finishes rendering the test page.
 */
function whenErrorsSectionReady(copyPromptButton, cb, timeoutMs = 2000) {
  const section = findErrorsSection(copyPromptButton);
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
    const s = findErrorsSection(copyPromptButton);
    if (s) {
      obs.disconnect();
      cb(s);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  // Hard timeout so we don't keep observing forever if the section never lands.
  setTimeout(() => obs.disconnect(), timeoutMs + 100);
}

function renderInlineAnalysis(analysisData, copyPromptButton, askBtn, testIdOverride) {
  // Remove any existing inline analysis
  const existing = document.getElementById('llm-inline-analysis');
  if (existing) existing.remove();

  // The analysis is plain markdown (the Category footer is stripped
  // server-side before persistence), so we can render it directly.

  // Defer to whenErrorsSectionReady so a still-rendering report (initial load
  // or a retry-tab swap) eventually gets the analysis inserted, instead of the
  // previous silent no-op.
  whenErrorsSectionReady(copyPromptButton, (errorsSection) => {
    // Re-check existing right before insert — another path may have raced us.
    document.getElementById('llm-inline-analysis')?.remove();

    // Hide the Ask LLM button — analysis is shown inline instead
    if (askBtn) askBtn.style.display = 'none';

    const categoryBadge = analysisData.category
      ? `<span class="llm-category-badge">${analysisData.category}</span>`
      : '';
    // Mark reused analyses (signature-match short-circuit copies the prior result without
    // hitting the LLM). Lets the user know the analysis is a previously-seen one.
    const reusedBadge = analysisData.reusedFromAnalysisId
      ? `<span class="llm-reused-badge" title="Same error signature as a previous run — analysis was reused without calling the LLM. Click Retry to force a fresh analysis.">♻ Reused</span>`
      : '';

    const retryBtnHtml = llmEnabled ? '<button class="llm-retry-btn">Retry</button>' : '';
    // Skip when we don't have a testId or when this row is a clone from a
    // prior run (reused analyses sit next to the original; their prompt belongs
    // to that other run, not this one).
    const resolvedTestId =
      testIdOverride ||
      analysisData.testId ||
      (copyPromptButton && copyPromptButton.dataset && copyPromptButton.dataset.testId) ||
      '';
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

    // Insert above the errors section
    errorsSection.parentNode.insertBefore(section, errorsSection);
    // Hide the sibling "Copy prompt" button next to Ask LLM — the analysis
    // header owns that affordance while an analysis is rendered.
    setFullCopyBtnVisibility(false);
    // A fresh analysis just landed — re-evaluate the "feedback not in latest
    // analysis" chip on the feedback panel. After Regenerate, the new
    // analysisData.updatedAt is later than feedback.updatedAt, so the chip
    // should hide. We compare against feedback fetched fresh from the server.
    if (resolvedTestId) {
      // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
      const rid = typeof reportId !== 'undefined' ? reportId : '';
      refreshFeedbackStaleIndicator(resolvedTestId, rid);
    }

    // Retry button re-triggers Ask LLM flow
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

    // In-analysis Copy prompt — same fresh-build behavior as the
    // next-to-Ask-LLM sibling. CLI `analysis-prompt` is the path for the
    // verbatim historical prompt.
    const copyPromptBtn = section.querySelector('.llm-copy-prompt-btn');
    if (copyPromptBtn) {
      copyPromptBtn.onclick = () => copyLLMPromptToClipboard(copyPromptBtn, resolvedTestId);
    }
  });
}

// ---- Feedback panel (test-level shared note) ----

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

function feedbackBody(testId, rid, extra) {
  return JSON.stringify({ testId: testId, reportId: rid, ...extra });
}

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

const EMPTY_HISTORY = { priorOccurrenceCount: 0, firstOccurrence: null };

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

// Lightweight check: does a stored analysis exist for this test, and was it reused
// from a prior analysis (signature-match short-circuit)? Used to surface a "♻ Reused"
// chip in the panel header so the reuse fact is visible at a glance, not just inside
// the inline analysis widget.
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

async function injectFeedbackPanel(testId, rid, copyPromptButton) {
  if (!testId || !rid || testId === 'unknown') return;
  // Avoid double-render
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
    copyPromptButton,
  });
}

function renderFeedbackPanel({
  feedback,
  related,
  history,
  analysisStatus,
  testId,
  reportId: rid,
  copyPromptButton,
}) {
  let panel = document.getElementById('llm-feedback-panel');
  const expanded = panel?.dataset.expanded === '1';
  const draftSnapshot = panel?.querySelector('.llm-feedback-textarea')?.value;
  // Preserve related/history/analysisStatus across re-renders triggered by save/delete
  // (which only refresh feedback).
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
    const insertionPoint = findErrorsSection(copyPromptButton);
    if (insertionPoint?.parentNode) {
      // Insert above the errors section so it sits near the analysis when present.
      insertionPoint.parentNode.insertBefore(panel, insertionPoint);
    } else {
      copyPromptButton.parentNode?.parentNode?.appendChild(panel);
    }
  }
  panel.__relatedCache = relatedEntries;
  panel.__historyCache = historyData;
  panel.__analysisStatusCache = status;

  // Compute stale flag: feedback updated after the most-recent persisted analysis for this (testId, reportId).
  // We don't know the analysis updatedAt synchronously here, so resolve lazily after render.
  const stateLabel = feedback
    ? `(updated ${relativeTimeShort(feedback.updatedAt)})`
    : 'No feedback yet';

  // Provenance lines — both hidden when they reference the report the user is currently viewing.
  // "First attached" = when feedback was first noted; "First found" = when this exact error
  // signature first occurred in test_runs. Different signals; both useful when not redundant.
  const originIsCurrent = feedback?.reportId === rid;
  const originLine =
    feedback?.reportId && feedback?.createdAt && !originIsCurrent
      ? `<div class="llm-feedback-origin">
          First attached in
          <a href="/report/${feedback.reportId}" target="_blank" rel="noopener">report ${feedback.reportId.slice(0, 8)}</a>
          — ${relativeTimeShort(feedback.createdAt)}
        </div>`
      : '';

  // First-found marker rendered inline in the header (next to the chips), not in the body —
  // it's a glance signal that shouldn't require expanding the panel. Hidden when the first
  // occurrence is the report being viewed, since the link would just point back to itself.
  const firstOccIsCurrent = historyData.firstOccurrence?.reportId === rid;
  const firstFoundInline =
    historyData.firstOccurrence && !firstOccIsCurrent
      ? `<span class="llm-feedback-firstfound">
          First found in
          <a href="/report/${historyData.firstOccurrence.reportId}" target="_blank" rel="noopener">report ${historyData.firstOccurrence.reportId.slice(0, 8)}</a>
          — ${relativeTimeShort(historyData.firstOccurrence.createdAt)}
        </span>`
      : '';

  // Header chips. Failure history (🆕 New / 🔁 N prior) is the primary signal — based on
  // test_runs with matching errorSignature, not on feedback. Cross-project feedback is a
  // secondary chip shown only when present.
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

  // Make the reuse fact obvious at the panel-header level — when the displayed analysis
  // wasn't generated for this specific test_run but copied from a prior one with the same
  // error signature, surface a "♻ Reused" chip alongside the other status chips.
  const reusedChip = status.reused
    ? `<span class="llm-feedback-reused-chip" title="The analysis shown for this test was reused from a previous run with the same error signature — it wasn't generated for this specific failure. Click Retry on the analysis (or Regenerate here) to force a fresh one.">♻ Reused</span>`
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
        <button class="llm-feedback-regenerate" type="button">Regenerate</button>
        <span class="llm-feedback-status"></span>
      </div>
      <label class="llm-feedback-cascade-label">
        <input type="checkbox" class="llm-feedback-cascade" />
        <span>Also refresh report summary after this test</span>
      </label>
    </div>
  `;

  // Clicking either chip expands the body. The `data-related-jump="1"` chip scrolls to the
  // related list; the failure-history chip just expands so the user can read "First found".
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
  const regenBtn = panel.querySelector('.llm-feedback-regenerate');
  const statusEl = panel.querySelector('.llm-feedback-status');
  const cascadeCheckbox = panel.querySelector('.llm-feedback-cascade');

  textarea.value = draftSnapshot ?? feedback?.comment ?? '';
  panel.dataset.expanded = expanded ? '1' : '0';

  // Disable Save when the trimmed draft is empty or unchanged from the saved note.
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
      renderFeedbackPanel({ feedback: j.data, testId, reportId: rid, copyPromptButton });
    } catch (err) {
      setStatus(err.message || 'Save failed', 'error');
    } finally {
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
      renderFeedbackPanel({ feedback: null, testId, reportId: rid, copyPromptButton });
    } catch (err) {
      setStatus(err.message || 'Delete failed', 'error');
    } finally {
      deleteBtn.disabled = false;
    }
  };

  regenBtn.onclick = async () => {
    setStatus('');
    const cascade = !!cascadeCheckbox?.checked;
    const originalLabel = regenBtn.textContent;
    regenBtn.disabled = true;
    regenBtn.textContent = 'Regenerating…';

    try {
      const response = await fetch('/api/llm/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testId,
          reportId: rid,
          ...(cascade ? { cascadeReportSummary: true } : {}),
        }),
      });
      const j = await response.json();
      if (!response.ok || !j?.success || !j?.data?.taskId) {
        throw new Error(j?.error || 'Failed to enqueue regenerate task');
      }
      // Render loading widget with the taskId so it can subscribe to SSE immediately
      whenErrorsSectionReady(copyPromptButton, (errorsSection) => {
        if (document.getElementById('llm-inline-analysis')) return;
        renderLoadingInto(testId, rid, copyPromptButton, null, errorsSection, j.data.taskId);
      });
    } catch (error) {
      console.error('[Playwright LLM] Regenerate error:', error);
      setStatus(error?.message || 'Regenerate failed', 'error');
    } finally {
      regenBtn.disabled = false;
      regenBtn.textContent = originalLabel;
    }
  };

  // Resolve stale indicator on initial render.
  refreshFeedbackStaleIndicator(testId, rid);
}

/**
 * Refresh the "⚠ Latest feedback not included in analysis" chip on the
 * feedback panel. The chip is sticky from the initial render; this function
 * re-fetches the latest analysis timestamp and toggles the chip, so a fresh
 * Regenerate/Retry cycle clears the warning as soon as the new analysis
 * lands. Safe to call when no panel exists — no-op in that case.
 */
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

let llmButtonRetryCount = 0;
const MAX_LLM_BUTTON_RETRIES = 100; // ~5 seconds at 50ms intervals

function tryInjectAskLLMButton() {
  const injected = injectAskLLMButton();

  if (!injected && llmButtonRetryCount < MAX_LLM_BUTTON_RETRIES) {
    llmButtonRetryCount++;
    // if no copy prompt button found yet, wait a bit longer and try again
    setTimeout(tryInjectAskLLMButton, 50);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', tryInjectAskLLMButton);
  // The Playwright report uses client-side navigation that we can't observe directly,
  // so we re-attempt injection on clicks that look like a test sub-page transition.
  document.addEventListener('click', (event) => {
    if (event?.target?.className?.includes('test-file-title')) {
      tryInjectAskLLMButton();
    }
  });
} else {
  setTimeout(tryInjectAskLLMButton, 50);
}

// The Playwright report swaps tests via URL hash without reloading. Re-check analysis
// when the testId changes so we don't keep stale state from the previously-viewed test.
globalThis.addEventListener?.('hashchange', () => {
  setTimeout(tryInjectAskLLMButton, 50);
});

// Body-level guardian observer. Playwright re-renders the errors-section DOM
// when the user clicks a different retry tab (no URL change, no event we can
// hook). When that swap removes our injected nodes we re-inject. The injection
// path is idempotent — if the Ask button + inline analysis are still present,
// `injectAskLLMButton` early-returns. Debounced so a burst of mutations only
// triggers one check.
(() => {
  if (typeof MutationObserver === 'undefined' || !document.body) return;

  let pending = null;
  const schedule = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      // Cheap pre-check: only run if either (a) there's a Copy prompt without a
      // sibling Ask LLM button, or (b) an Ask LLM button exists but the inline
      // analysis is missing for the current testId. Avoids work on unrelated
      // mutations (e.g., the modal opening, our own DOM inserts).
      const copyPromptBtns = Array.from(document.querySelectorAll('button')).filter(
        (b) =>
          b.textContent?.includes('Copy prompt') && !b.classList.contains('llm-copy-prompt-btn')
      );
      if (copyPromptBtns.length === 0) return;
      const btn = copyPromptBtns[0];
      const askBtn = btn.parentNode?.querySelector('.llm-ask-btn');
      // In read-only mode there's no Ask LLM button to inject; we only need to
      // re-attempt when the inline analysis was wiped by a Playwright DOM swap.
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
