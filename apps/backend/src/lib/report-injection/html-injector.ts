import fs from 'node:fs/promises';
import type { ParsedTestUrl } from '../utils/url-parser.js';

let injectAssetsPromise: Promise<{ style: string; script: string }> | undefined;
function loadInjectAssets(): Promise<{ style: string; script: string }> {
  if (!injectAssetsPromise) {
    injectAssetsPromise = Promise.all([
      fs.readFile(new URL('./inject.css', import.meta.url), 'utf-8'),
      fs.readFile(new URL('./inject.js', import.meta.url), 'utf-8'),
    ])
      .then(([style, script]) => ({ style, script }))
      .catch((err) => {
        injectAssetsPromise = undefined;
        throw err;
      });
  }
  return injectAssetsPromise;
}

export async function injectTestAnalysis(
  source: string,
  testUrl: ParsedTestUrl,
  isLlmEnabled: boolean,
  canEditCategory = false
): Promise<string> {
  if (!testUrl.reportId) {
    return source;
  }

  try {
    return await injectClientSideScript(source, testUrl, isLlmEnabled, canEditCategory);
  } catch (error) {
    console.error('[html-injector] Error injecting HTML:', error);
    return source;
  }
}

async function injectClientSideScript(
  html: string,
  testUrl: ParsedTestUrl,
  isLlmEnabled: boolean,
  canEditCategory: boolean
): Promise<string> {
  const { style: styleContent, script: scriptBody } = await loadInjectAssets();
  const scriptContent = `
    const reportId = ${JSON.stringify(testUrl.reportId)};
    const reportProject = ${JSON.stringify(testUrl.project ?? '')};
    const isLlmEnabled = ${isLlmEnabled ? 'true' : 'false'};
    const canEditCategory = ${canEditCategory ? 'true' : 'false'};
    ${scriptBody}`;

  const styleTag = `<style>${styleContent}</style>`;
  const scriptTag = `<script>${scriptContent}</script>`;

  // Use the function form of `.replace` so `$&`, `$1`, etc. inside the
  // injected style/script bodies aren't interpreted as substitution patterns.
  let result = html;
  result = result.includes('</head>')
    ? result.replace('</head>', () => `${styleTag}</head>`)
    : `${styleTag}${result}`;
  result = result.includes('</body>')
    ? result.replace('</body>', () => `${scriptTag}</body>`)
    : `${result}${scriptTag}`;
  return result;
}
