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
    // biome-ignore lint/correctness/noUndeclaredVariables: provided by outer scope
    injectFeedbackPanel(currentTestId, reportId, copyPromptButton);
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
    console.warn('[Playwright LLM] Error extracting test ID from URL:', error);
    return 'unknown';
  }
}

function showLLMAnalysis(prompt, askBtn, testId = 'unknown', copyPromptButton = null) {
  let modal = document.getElementById('llm-analysis-modal');
  if (!modal) {
    modal = createLLMModal();
    document.body.appendChild(modal);
  }

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
        let finalContent = answerContent || thinkingContent;
        // LLM may return structured JSON (possibly wrapped in markdown code fences)
        try {
          let jsonStr = finalContent.trim();
          const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
          if (fenceMatch) jsonStr = fenceMatch[1].trim();
          const parsed = JSON.parse(jsonStr);
          if (parsed.analysis) finalContent = parsed.analysis;
        } catch {
          /* not JSON — use as-is */
        }
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
                  console.error('[Playwright LLM] Failed to parse SSE data:', parseError);
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
      console.error('[Playwright LLM] Analysis error:', error);
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
  return (
    copyPromptButton.closest('.test-result-error') ||
    copyPromptButton.parentNode?.parentNode ||
    copyPromptButton.parentNode
  );
}

function renderInlineAnalysis(analysisData, copyPromptButton, askBtn) {
  // Remove any existing inline analysis
  const existing = document.getElementById('llm-inline-analysis');
  if (existing) existing.remove();

  // Handle analysis stored as JSON (possibly wrapped in markdown code fences)
  if (analysisData.analysis && typeof analysisData.analysis === 'string') {
    try {
      let jsonStr = analysisData.analysis.trim();
      // Strip markdown code fences: ```json ... ``` or ``` ... ```
      const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      const parsed = JSON.parse(jsonStr);
      if (parsed.analysis) {
        analysisData.analysis = parsed.analysis;
        if (parsed.category && !analysisData.category) analysisData.category = parsed.category;
      }
    } catch {
      /* not JSON — use as-is */
    }
  }

  const errorsSection = findErrorsSection(copyPromptButton);
  if (!errorsSection) return;

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
  const staleEl = panel.querySelector('.llm-feedback-stale');
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
    regenBtn.disabled = true;
    setStatus('Enqueueing…');
    try {
      const cascade = !!cascadeCheckbox?.checked;
      const r = await fetch('/api/llm/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: feedbackBody(testId, rid, cascade ? { cascadeReportSummary: true } : {}),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error || 'Regenerate failed');
      const cascadeMsg = j?.data?.cascadedReportTaskId ? ' (report regen queued)' : '';
      setStatus(
        (j?.data?.deduped ? 'Already in progress' : 'Analysis enqueued') + cascadeMsg,
        'ok'
      );
    } catch (err) {
      setStatus(err.message || 'Regenerate failed', 'error');
    } finally {
      regenBtn.disabled = false;
    }
  };

  // Resolve stale indicator: compare feedback.updatedAt with the persisted analysis updatedAt.
  if (feedback) {
    fetch(`/api/test-analysis/${encodeURIComponent(testId)}?reportId=${encodeURIComponent(rid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const analysisAt = data?.data?.updatedAt || data?.data?.createdAt;
        if (analysisAt && new Date(feedback.updatedAt).getTime() > new Date(analysisAt).getTime()) {
          staleEl.removeAttribute('hidden');
        }
      })
      .catch(() => {
        // ignore — stale indicator is best-effort
      });
  }
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
