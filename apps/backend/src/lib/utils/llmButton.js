function injectAskLLMButton() {
  const copyPromptButtons = Array.from(document.querySelectorAll('button')).filter((btn) =>
    btn.textContent?.includes('Copy prompt')
  );

  if (!copyPromptButtons.length) {
    return false;
  }

  const copyPromptButton = copyPromptButtons.at(0);

  const existingAskBtn = copyPromptButton.parentNode?.querySelector('.llm-ask-btn');
  if (existingAskBtn) {
    return;
  }

  const askBtn = document.createElement('button');
  askBtn.textContent = 'Ask LLM';
  askBtn.className = 'button llm-ask-btn';
  askBtn.style.minWidth = '100px';
  askBtn.style.marginLeft = '8px';

  askBtn.onclick = async () => {
    const currentTestId = extractTestIdFromCurrentUrl();

    try {
      copyPromptButton.click();
      const prompt = globalThis.currentPrompt;

      if (prompt?.trim()) {
        showLLMAnalysis(prompt, askBtn, currentTestId, copyPromptButton);
        return;
      }
    } catch {
      // fallback to clipboard
    }

    try {
      const permission = await navigator.permissions.query({ name: 'clipboard-read' });
      if (permission.state === 'denied') {
        showLLMAnalysis(
          'Clipboard access is denied. Please allow clipboard access and try again.',
          askBtn,
          undefined,
          copyPromptButton
        );
        return;
      }
    } catch (error) {
      // clipboard permission API access not granted, proceed anyway
    }

    try {
      copyPromptButton.click();
      // wait for 100ms till prompt populated to clipboard
      await new Promise((resolve) => setTimeout(resolve, 100));
      const prompt = await navigator.clipboard.readText();

      if (prompt?.trim()) {
        showLLMAnalysis(prompt, askBtn, currentTestId, copyPromptButton);
      } else {
        throw new Error('clipboard is empty');
      }
    } catch (error) {
      console.error('[Playwright LLM] Failed to read from clipboard:', error);

      const suggestion = {
        NotAllowedError: 'Please allow clipboard access and try again.',
        NotFoundError: 'Clipboard is empty. Please click "Copy prompt" first.',
        default: 'Please click "Copy prompt" button manually and try again.',
      };
      const errorMessage = `Unable to access clipboard. ${suggestion[error.name] || suggestion.default}`;
      showLLMAnalysis(errorMessage, askBtn, currentTestId, copyPromptButton);
    }
  };

  copyPromptButton.parentNode?.insertBefore(askBtn, copyPromptButton.nextSibling);

  // Check for pre-computed LLM analysis — if found, show inline and hide Ask LLM button
  const currentTestId = extractTestIdFromCurrentUrl();
  if (currentTestId && currentTestId !== 'unknown') {
    checkForPrecomputedAnalysis(currentTestId, copyPromptButton, askBtn);
  }

  return true;
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
    console.log('[Playwright LLM] Error extracting test ID from URL:', error);
    return 'unknown';
  }
}

function showLLMAnalysis(prompt, askBtn, testId = 'unknown', copyPromptButton = null) {
  let modal = document.getElementById('llm-analysis-modal');
  if (!modal) {
    modal = createLLMModal();
    document.body.appendChild(modal);
  }

  // loading state
  modal.style.display = 'flex';
  const content = modal.querySelector('.llm-modal-content');
  content.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 40px;">
      <div class="llm-spinner" style="
        width: 40px;
        height: 40px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #3b82f6;
        border-radius: 50%;
        animation: llm-spin 1s linear infinite;
        margin-bottom: 20px;
      "></div>
      <div style="color: var(--llm-body-text); font-size: 16px; font-weight: 500;">LLM is thinking 🤔...</div>
      <div style="color: var(--llm-body-text); font-size: 14px; font-weight: 500;">(kind of)</div>
      <div style="color: var(--llm-muted); font-size: 14px; margin-top: 8px;">This may take a few seconds</div>
    </div>
    <style>
      @keyframes llm-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
  `;

  // disable button during analysis
  askBtn.disabled = true;
  askBtn.textContent = 'Analyzing...';

  if (
    prompt.includes('Unable to extract prompt') ||
    prompt.includes('copy the prompt') ||
    prompt.includes('Clipboard access is denied')
  ) {
    content.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px;">
        <div style="
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background-color: #fef3c7;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 16px;
          font-size: 24px;
        ">⚠️</div>
        <div style="
          color: var(--llm-body-text);
          font-size: 16px;
          font-weight: 500;
          text-align: center;
          margin-bottom: 8px;
        ">Unable to Access Clipboard</div>
        <div style="
          color: var(--llm-muted);
          font-size: 14px;
          text-align: center;
          line-height: 1.5;
          max-width: 400px;
        ">${prompt}</div>
      </div>
    `;
    askBtn.disabled = false;
    askBtn.textContent = 'Ask LLM';
    return;
  }

  fetch(`/api/llm/analyze-failed-test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      testId: testId,
      // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
      reportId: reportId,
      prompt: prompt,
    }),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      let thinkingContent = '';
      let answerContent = '';
      let isThinking = false;
      let modelData = null;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      content.innerHTML = `
        <div style="
          display: flex;
          flex-direction: column;
          gap: 16px;
        ">
          <div style="
            display: flex;
            align-items: center;
            gap: 8px;
          ">
            <div style="
              width: 32px;
              height: 32px;
              background: linear-gradient(135deg, #10b981, #059669);
              border-radius: 8px;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 16px;
            ">🔍</div>
            <h2 style="margin: 0; color: var(--llm-body-text); font-size: 20px; font-weight: 600;">Test Failure Analysis</h2>
          </div>
          <div id="llm-thinking-block" style="
            display: none;
            background: var(--llm-thinking-bg);
            border-left: 4px solid var(--llm-thinking-border);
            padding: 16px 20px;
            border-radius: 8px;
            font-size: 13px;
            color: var(--llm-thinking-text);
            line-height: 1.6;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            max-height: 200px;
            overflow-y: auto;
          ">
            <div style="font-weight: 600; margin-bottom: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">💭 Thinking...</div>
            <div id="llm-thinking-text"></div>
          </div>
          <div id="llm-streaming-content" style="
            background: var(--llm-stream-bg);
            border-left: 4px solid #3b82f6;
            padding: 20px;
            border-radius: 8px;
            min-height: 60px;
            line-height: 1.7;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 15px;
            color: var(--llm-body-text);
          "></div>
          <div id="llm-streaming-footer" style="
            display: none;
            justify-content: space-between;
            align-items: center;
            padding-top: 16px;
            border-top: 1px solid var(--llm-btn-border);
            margin-top: 8px;
            font-size: 13px;
            color: var(--llm-muted);
          "></div>
        </div>
      `;

      const thinkingBlock = content.querySelector('#llm-thinking-block');
      const thinkingText = content.querySelector('#llm-thinking-text');
      const streamingContent = content.querySelector('#llm-streaming-content');
      const streamingFooter = content.querySelector('#llm-streaming-footer');

      function processThinking(text) {
        thinkingContent += text;
        if (thinkingBlock && thinkingText) {
          if (!isThinking) {
            isThinking = true;
            thinkingBlock.style.display = 'block';
            streamingContent.style.display = 'none';
          }
          thinkingText.textContent = thinkingContent;
          thinkingBlock.scrollTop = thinkingBlock.scrollHeight;
        }
      }

      function processToken(text) {
        answerContent += text;
        if (streamingContent) {
          if (isThinking) {
            // Transition from thinking to answer
            isThinking = false;
            streamingContent.style.display = 'block';
            // Collapse thinking block
            if (thinkingBlock) {
              thinkingBlock.querySelector('div').textContent = '💭 Thinking (done)';
              thinkingBlock.style.maxHeight = '80px';
              thinkingBlock.style.cursor = 'pointer';
              thinkingBlock.onclick = () => {
                const isCollapsed = thinkingBlock.style.maxHeight === '80px';
                thinkingBlock.style.maxHeight = isCollapsed ? '400px' : '80px';
              };
            }
          }
          streamingContent.textContent = answerContent;
          streamingContent.scrollTop = streamingContent.scrollHeight;
        }
      }

      function finalizeResponse() {
        const finalContent = answerContent || thinkingContent;
        if (streamingContent) {
          streamingContent.style.display = 'block';
          streamingContent.innerHTML = markdownToHtml(finalContent);
        }
        // Format thinking block markdown
        if (thinkingContent && thinkingText && answerContent) {
          thinkingText.innerHTML = markdownToHtml(thinkingContent);
        }
        // If only thinking was received, hide the thinking block since we moved it to the main area
        if (!answerContent && thinkingContent && thinkingBlock) {
          thinkingBlock.style.display = 'none';
        }

        if (streamingFooter) {
          streamingFooter.style.display = 'flex';
          streamingFooter.innerHTML = `
            <div>Analysis powered by ${modelData || 'LLM'}</div>
            <div>${new Date().toLocaleString()}</div>
          `;
        }

        // Also render the result inline above the errors section
        if (finalContent && copyPromptButton) {
          // Close the modal after a short delay
          setTimeout(() => {
            if (modal) modal.style.display = 'none';
          }, 500);
          showInlineAnalysisFromStream(finalContent, modelData, copyPromptButton, askBtn);
        }
      }

      return new Promise((resolve, reject) => {
        function read() {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) {
                finalizeResponse();
                resolve();
                return;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine || !trimmedLine.startsWith('data: ')) {
                  continue;
                }

                try {
                  const data = JSON.parse(trimmedLine.slice(6));

                  if (data.type === 'thinking' && data.content) {
                    processThinking(data.content);
                  } else if (data.type === 'token' && data.content) {
                    processToken(data.content);
                  } else if (data.type === 'done') {
                    modelData = data.model;
                  } else if (data.type === 'error') {
                    throw new Error(data.error || 'Stream error occurred');
                  }
                } catch (parseError) {
                  console.error('Failed to parse SSE data:', parseError);
                }
              }

              read();
            })
            .catch(reject);
        }

        read();
      });
    })
    .catch((error) => {
      console.error('Analysis error:', error);
      content.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px;">
          <div style="
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background-color: #fee2e2;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 16px;
            font-size: 24px;
          ">❌</div>
          <div style="
            color: var(--llm-body-text);
            font-size: 16px;
            font-weight: 500;
            text-align: center;
            margin-bottom: 8px;
          ">Analysis Failed</div>
          <div style="
            color: var(--llm-muted);
            font-size: 14px;
            text-align: center;
            line-height: 1.5;
            max-width: 400px;
          ">${error.message || 'Analysis failed. Please try again.'}</div>
        </div>
      `;
    })
    .finally(() => {
      askBtn.disabled = false;
      askBtn.textContent = 'Ask LLM';
    });
}

function createLLMModal() {
  const modal = document.createElement('div');
  modal.id = 'llm-analysis-modal';
  modal.style.cssText = `
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: var(--llm-modal-overlay);
          z-index: 10000;
          align-items: center;
          justify-content: center;
          font-family: system-ui, -apple-system, sans-serif;
          backdrop-filter: blur(4px);
        `;

  const modalContent = document.createElement('div');
  modalContent.className = 'llm-modal-content';
  modalContent.style.cssText = `
          background: var(--llm-modal-bg);
          color: var(--llm-body-text);
          border-radius: 12px;
          padding: 32px;
          max-width: 800px;
          max-height: 80vh;
          overflow-y: auto;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
          position: relative;
          margin: 20px;
        `;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = `
          position: absolute;
          top: 16px;
          right: 16px;
          background: var(--llm-btn-bg);
          border: 1px solid var(--llm-btn-border);
          width: 32px;
          height: 32px;
          border-radius: 6px;
          font-size: 20px;
          font-weight: 400;
          cursor: pointer;
          color: var(--llm-btn-text);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        `;

  closeBtn.onmouseover = () => {
    closeBtn.style.opacity = '0.8';
    closeBtn.style.transform = 'scale(1.05)';
  };

  closeBtn.onmouseout = () => {
    closeBtn.style.opacity = '1';
    closeBtn.style.transform = 'scale(1)';
  };
  closeBtn.onclick = () => {
    modal.style.display = 'none';
  };

  modalContent.appendChild(closeBtn);
  modal.appendChild(modalContent);

  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  };

  return modal;
}

function formatLLMResponse(data) {
  let html = '<div>';
  html += `
    <div style="
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
    ">
      <div style="
        width: 32px;
        height: 32px;
        background: linear-gradient(135deg, #10b981, #059669);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 16px;
      ">🔍</div>
      <h2 style="margin: 0; color: var(--llm-body-text); font-size: 20px; font-weight: 600;">Test Failure Analysis</h2>
    </div>
  `;

  const formattedContent = markdownToHtml(data.content || 'No analysis available');

  html += `
    <div style="
      background: var(--llm-stream-bg);
      border-left: 4px solid #3b82f6;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    ">
      <div style="
        color: var(--llm-body-text);
        line-height: 1.7;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 15px;
      ">${formattedContent}</div>
    </div>
  `;

  html += `
    <div style="
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 16px;
      border-top: 1px solid var(--llm-btn-border);
      margin-top: 24px;
      font-size: 13px;
      color: var(--llm-muted);
    ">
      <div>Analysis powered by ${data.model || 'LLM'}</div>
      <div>${new Date().toLocaleString()}</div>
    </div>
  `;
  html += '</div>';
  return html;
}

function markdownToHtml(text) {
  if (!text) return 'No analysis available';

  let html = text;

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

  // bullet points
  html = html.replaceAll(/^\* (.+)$/gim, '<li style="margin: 4px 0; color: var(--llm-body-text);">• $1</li>');

  // wrap bullet lists
  html = html.replaceAll(
    /(<li.*<\/li>)/gs,
    '<ul style="margin: 12px 0; padding-left: 20px; list-style: none;">$1</ul>'
  );

  // numbered lists
  html = html.replaceAll(/^\d+\. (.+)$/gim, '<li style="margin: 4px 0; color: var(--llm-body-text);">$1</li>');

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

function checkForPrecomputedAnalysis(testId, copyPromptButton, askBtn) {
  // reportId is injected as a global by html-injector.ts
  const rid = typeof reportId !== 'undefined' ? reportId : '';
  fetch(`/api/test-analysis/${encodeURIComponent(testId)}?reportId=${encodeURIComponent(rid)}`)
    .then((response) => {
      if (!response.ok) return null;
      return response.json();
    })
    .then((data) => {
      if (data?.success && data?.data?.analysis) {
        renderInlineAnalysis(data.data, copyPromptButton, askBtn);
      }
    })
    .catch(() => {
      // Silently fail — no section injected
    });
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
  return copyPromptButton.closest('.test-result-error')
    || copyPromptButton.parentNode?.parentNode
    || copyPromptButton.parentNode;
}

function renderInlineAnalysis(analysisData, copyPromptButton, askBtn) {
  // Remove any existing inline analysis
  const existing = document.getElementById('llm-inline-analysis');
  if (existing) existing.remove();

  const errorsSection = findErrorsSection(copyPromptButton);
  if (!errorsSection) return;

  // Hide the Ask LLM button — analysis is shown inline instead
  if (askBtn) askBtn.style.display = 'none';

  const categoryBadge = analysisData.category
    ? `<span class="llm-category-badge">${analysisData.category}</span>`
    : '';

  const section = document.createElement('div');
  section.id = 'llm-inline-analysis';
  section.innerHTML = `
    <div class="llm-inline-header">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="llm-title">LLM Analysis</span>
        ${categoryBadge}
        <span class="llm-model">${analysisData.model || ''}</span>
      </div>
      <button class="llm-retry-btn">Retry</button>
    </div>
    <div class="llm-inline-body">
      ${markdownToHtml(analysisData.analysis)}
    </div>
  `;

  // Insert above the errors section
  errorsSection.parentNode.insertBefore(section, errorsSection);

  // Retry button re-triggers Ask LLM flow
  section.querySelector('.llm-retry-btn').onclick = () => {
    section.remove();
    if (askBtn) {
      askBtn.style.display = '';
      askBtn.click();
    }
  };
}

/**
 * After an Ask LLM SSE stream completes, show the result inline
 * (called from showLLMAnalysis on success).
 */
function showInlineAnalysisFromStream(content, model, copyPromptButton, askBtn) {
  renderInlineAnalysis(
    { analysis: content, model: model, category: null },
    copyPromptButton,
    askBtn
  );
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

// try to inject button after the page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', tryInjectAskLLMButton);
  // handle case with internal playwright report redirects that are not tracked
  // so we can listen to clicks, and if it is a test sub-page - try injection
  document.addEventListener('click', (event) => {
    console.log(event);
    if (event?.target?.className?.includes('test-file-title')) {
      tryInjectAskLLMButton();
    }
  });
} else {
  setTimeout(tryInjectAskLLMButton, 50);
}
