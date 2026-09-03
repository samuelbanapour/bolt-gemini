/**
 * Bolt.gemini Client-Side Application Controller
 * Handles WebContainer lifecycle, Monaco Editor, Terminal,
 * Streaming Gemini AI responses, and Render instant deployments.
 */

// Application State
let webcontainerInstance = null;
let monacoEditor = null;
let terminal = null;
let fitAddon = null;
let currentOpenFilePath = null;
const virtualFileSystem = new Map(); // path -> content
let conversationHistory = [];

// DOM Elements
const statusIndicator = document.getElementById('status-indicator');
const chatMessages = document.getElementById('chat-messages');
const promptInput = document.getElementById('prompt-input');
const btnSend = document.getElementById('btn-send');
const fileTabs = document.getElementById('file-tabs');
const treeContent = document.getElementById('tree-content');
const previewFrame = document.getElementById('preview-frame');
const previewPlaceholder = document.getElementById('preview-placeholder');
const previewOpenLink = document.getElementById('preview-open-link');
const btnRefreshPreview = document.getElementById('btn-refresh-preview');
const tabPreview = document.getElementById('tab-preview');
const tabTerminal = document.getElementById('tab-terminal');
const previewWrapper = document.getElementById('preview-wrapper');
const terminalWrapper = document.getElementById('terminal-wrapper');
const btnDeploy = document.getElementById('btn-deploy');
const deployModal = document.getElementById('deploy-modal');
const btnCloseDeploy = document.getElementById('btn-close-deploy');
const btnConfirmDeploy = document.getElementById('btn-confirm-deploy');
const deployProjectName = document.getElementById('deploy-project-name');
const deployStatusBox = document.getElementById('deploy-status-box');
const deployStatusText = document.getElementById('deploy-status-text');
const deploySuccessBox = document.getElementById('deploy-success-box');
const deployLiveUrl = document.getElementById('deploy-live-url');
const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const inputGeminiKey = document.getElementById('input-gemini-key');
const inputRenderKey = document.getElementById('input-render-key');

/**
 * Bootstrap the IDE components safely
 */
function bootstrap() {
  console.log('⚡ Initializing Bolt.gemini IDE...');
  initSettings();
  initTabs();
  initChatListeners();
  initTerminal();
  initMonaco();
  initWebContainer();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

function initSettings() {
  if (!inputGeminiKey) return;
  inputGeminiKey.value = localStorage.getItem('gemini_api_key') || '';
  inputRenderKey.value = localStorage.getItem('render_api_key') || '';

  btnSettings?.addEventListener('click', () => settingsModal?.classList.remove('hidden'));
  btnCloseSettings?.addEventListener('click', () => settingsModal?.classList.add('hidden'));
  btnSaveSettings?.addEventListener('click', () => {
    localStorage.setItem('gemini_api_key', inputGeminiKey.value.trim());
    localStorage.setItem('render_api_key', inputRenderKey.value.trim());
    settingsModal?.classList.add('hidden');
  });

  // Suggestion chips
  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (promptInput) {
        promptInput.value = chip.textContent.replace(/^"|"$/g, '');
        promptInput.focus();
      }
    });
  });
}

function initTabs() {
  tabPreview?.addEventListener('click', () => {
    tabPreview.classList.add('active');
    tabTerminal?.classList.remove('active');
    previewWrapper?.classList.add('active');
    terminalWrapper?.classList.remove('active');
  });

  tabTerminal?.addEventListener('click', () => {
    tabTerminal.classList.add('active');
    tabPreview?.classList.remove('active');
    terminalWrapper?.classList.add('active');
    previewWrapper?.classList.remove('active');
    if (fitAddon) {
      try { fitAddon.fit(); } catch (e) {}
    }
  });

  btnRefreshPreview?.addEventListener('click', () => {
    if (previewFrame && previewFrame.src && previewFrame.src !== 'about:blank') {
      const current = previewFrame.src;
      previewFrame.src = 'about:blank';
      setTimeout(() => { previewFrame.src = current; }, 50);
    } else {
      updateStaticPreviewFallback();
    }
  });
}

function initChatListeners() {
  btnSend?.addEventListener('click', () => {
    const prompt = promptInput?.value?.trim();
    if (!prompt) return;
    promptInput.value = '';
    executeGeminiTurn(prompt);
  });

  promptInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      btnSend?.click();
    }
  });
}

function initTerminal() {
  try {
    if (typeof Terminal !== 'undefined') {
      terminal = new Terminal({
        convertEol: true,
        fontSize: 13,
        fontFamily: 'JetBrains Mono, Fira Code, monospace',
        theme: {
          background: '#000000',
          foreground: '#d4d4d4'
        }
      });

      if (typeof FitAddon !== 'undefined') {
        fitAddon = new FitAddon.FitAddon();
        terminal.loadAddon(fitAddon);
      }

      const termContainer = document.getElementById('terminal-container');
      if (termContainer) {
        terminal.open(termContainer);
        if (fitAddon) fitAddon.fit();
      }

      terminal.writeln('\x1b[1;34m⚡ Bolt.gemini Terminal Initialized\x1b[0m');
    }
  } catch (err) {
    console.warn('Terminal initialization failed:', err);
  }
}

function initMonaco() {
  const monacoContainer = document.getElementById('monaco-container');
  if (!monacoContainer) return;

  if (window.require) {
    try {
      window.require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.51.0/min/vs' } });
      window.require(['vs/editor/editor.main'], () => {
        monacoEditor = monaco.editor.create(monacoContainer, {
          value: '// Welcome to Bolt.gemini' + String.fromCharCode(10) + '// Type a prompt on the left to generate and run your application in real-time.',
          language: 'javascript',
          theme: 'vs-dark',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 13
        });

        monacoEditor.onDidChangeModelContent(async () => {
          if (!currentOpenFilePath) return;
          const updatedValue = monacoEditor.getValue();
          virtualFileSystem.set(currentOpenFilePath, updatedValue);
          if (webcontainerInstance) {
            try {
              await webcontainerInstance.fs.writeFile(currentOpenFilePath, updatedValue);
            } catch (err) {
              console.warn('Sync to WebContainer failed:', err);
            }
          }
          updateStaticPreviewFallback();
        });
      }, (err) => {
        console.warn('Monaco failed to load from CDN, using fallback editor:', err);
        setupFallbackEditor();
      });
    } catch (e) {
      setupFallbackEditor();
    }
  } else {
    setupFallbackEditor();
  }
}

function setupFallbackEditor() {
  const container = document.getElementById('monaco-container');
  if (!container || container.querySelector('textarea')) return;
  container.innerHTML = `<textarea id="fallback-code-editor" style="width:100%;height:100%;background:#1e1e1e;color:#f1f3f9;font-family:monospace;padding:1rem;border:none;outline:none;resize:none;font-size:13px;"></textarea>`;
  const textarea = document.getElementById('fallback-code-editor');
  textarea.value = '// Welcome to Bolt.gemini' + String.fromCharCode(10) + '// Enter a prompt on the left to generate code.';
  textarea.addEventListener('input', async () => {
    if (!currentOpenFilePath) return;
    virtualFileSystem.set(currentOpenFilePath, textarea.value);
    if (webcontainerInstance) {
      try {
        await webcontainerInstance.fs.writeFile(currentOpenFilePath, textarea.value);
      } catch (e) {}
    }
    updateStaticPreviewFallback();
  });
}

/**
 * Boot WebContainer sandbox with timeout and cross-origin isolation verification
 */
async function initWebContainer() {
  if (statusIndicator) {
    statusIndicator.textContent = 'Sandbox: Checking environment...';
  }

  // 1. Verify Cross-Origin Isolation (SharedArrayBuffer)
  if (!window.crossOriginIsolated) {
    const warning = 'Browser context is not cross-origin isolated. WebContainers require COOP & COEP headers.';
    console.warn(warning);
    if (terminal) {
      terminal.writeln(`\r
\x1b[33m[Notice] Cross-Origin Isolation is not active.\x1b[0m`);
      terminal.writeln(`\x1b[33mCode generation and Monaco editor will run in Direct Preview mode.\x1b[0m\r
`);
    }
    if (statusIndicator) {
      statusIndicator.textContent = 'Sandbox: Direct Mode';
      statusIndicator.style.color = '#38bdf8';
    }
    if (btnDeploy) btnDeploy.disabled = false;
    return;
  }

  // 2. Dynamically import WebContainer API from local server proxy
  try {
    if (statusIndicator) statusIndicator.textContent = 'Sandbox: Loading WebContainer API...';

    const { WebContainer } = await import('/vendor/webcontainer.js');

    if (statusIndicator) statusIndicator.textContent = 'Sandbox: Booting Node.js WASM...';

    // Race boot with 15s timeout
    const bootPromise = WebContainer.boot();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('WebContainer boot timed out after 15 seconds')), 15000)
    );

    webcontainerInstance = await Promise.race([bootPromise, timeoutPromise]);

    if (statusIndicator) {
      statusIndicator.textContent = 'Sandbox: Ready';
      statusIndicator.style.color = '#10b981';
    }
    if (btnDeploy) btnDeploy.disabled = false;

    // Listen for dev server ready event
    webcontainerInstance.on('server-ready', (port, url) => {
      if (terminal) {
        terminal.writeln(`\r
\x1b[1;32m⚡ Dev Server ready at: ${url} (port ${port})\x1b[0m\r
`);
      }
      if (previewFrame) previewFrame.src = url;
      previewPlaceholder?.classList.add('hidden');
      if (previewOpenLink) previewOpenLink.href = url;
      tabPreview?.click();
    });

    webcontainerInstance.on('error', (err) => {
      if (terminal) {
        terminal.writeln(`\r
\x1b[1;31m[WebContainer Error] ${err.message}\x1b[0m\r
`);
      }
    });

    if (terminal) {
      terminal.writeln('\x1b[1;32m✔ WebContainer Node.js sandbox ready.\x1b[0m');
    }
  } catch (err) {
    console.warn('WebContainer boot issue:', err);
    if (statusIndicator) {
      statusIndicator.textContent = 'Sandbox: Direct Mode';
      statusIndicator.style.color = '#38bdf8';
    }
    if (terminal) {
      terminal.writeln(`\r
\x1b[33m[Sandbox Notice] ${err.message}\x1b[0m`);
      terminal.writeln(`\x1b[32mCode generation and live static preview are fully active.\x1b[0m\r
`);
    }
    if (btnDeploy) btnDeploy.disabled = false;
  }
}

/**
 * Execute command inside WebContainer and stream to xterm.js
 */
async function runCommand(commandStr, isBackground = false) {
  if (!webcontainerInstance) {
    if (terminal) {
      terminal.writeln(`\r
\x1b[90m[Direct Mode] ${commandStr}\x1b[0m`);
    }
    updateStaticPreviewFallback();
    return 0;
  }

  if (terminal) {
    terminal.writeln(`\r
\x1b[1;36m$ ${commandStr}\x1b[0m\r
`);
  }

  const parts = commandStr.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  try {
    const process = await webcontainerInstance.spawn(cmd, args);

    let capturedStderr = '';
    process.output.pipeTo(
      new WritableStream({
        write(data) {
          if (terminal) terminal.write(data);
          if (data.toLowerCase().includes('error') || data.toLowerCase().includes('failed')) {
            capturedStderr += data;
          }
        }
      })
    );

    if (!isBackground) {
      const exitCode = await process.exit;
      if (exitCode !== 0 && capturedStderr) {
        handleAutoHeal(capturedStderr);
      }
      return exitCode;
    }
  } catch (err) {
    if (terminal) terminal.writeln(`\r
\x1b[31mCommand failed: ${err.message}\x1b[0m\r
`);
  }
}

/**
 * Auto-heal error prompt
 */
function handleAutoHeal(errorMessage) {
  const autoFixNotice = document.createElement('div');
  autoFixNotice.className = 'message assistant';
  autoFixNotice.innerHTML = `
    <p>⚠️ <strong>Build/Runtime Error detected:</strong></p>
    <pre style="font-size: 0.75rem; color: #f87171; overflow-x: auto; margin: 0.5rem 0;">${escapeHtml(errorMessage.slice(0, 300))}</pre>
    <button class="btn btn-secondary btn-sm" id="btn-fix-error">🛠️ Ask Gemini to Auto-Fix</button>
  `;
  chatMessages.appendChild(autoFixNotice);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  document.getElementById('btn-fix-error')?.addEventListener('click', () => {
    executeGeminiTurn('', errorMessage);
  });
}

/**
 * Execute Gemini Agent Turn via SSE
 */
async function executeGeminiTurn(prompt, terminalError = null) {
  if (prompt) {
    appendUserMessage(prompt);
  }

  if (btnSend) btnSend.disabled = true;
  if (statusIndicator) statusIndicator.textContent = 'Gemini: Generating solution...';

  // Prepare current files for context
  const fileContext = {};
  for (const [path, content] of virtualFileSystem.entries()) {
    if (!path.includes('node_modules') && !path.includes('package-lock.json')) {
      fileContext[path] = content.slice(0, 3000);
    }
  }

  const assistantMsgEl = document.createElement('div');
  assistantMsgEl.className = 'message assistant';
  chatMessages.appendChild(assistantMsgEl);

  const explanationEl = document.createElement('div');
  assistantMsgEl.appendChild(explanationEl);

  let currentArtifactEl = null;

  const parser = new ClientArtifactParser({
    onExplanationChunk(chunk) {
      explanationEl.innerHTML += chunk.split(String.fromCharCode(10)).map(escapeHtml).join('<br>');
      chatMessages.scrollTop = chatMessages.scrollHeight;
    },
    onArtifactStart(artifact) {
      currentArtifactEl = document.createElement('div');
      currentArtifactEl.className = 'artifact-box';
      currentArtifactEl.innerHTML = `<div class="artifact-title">⚡ ${escapeHtml(artifact.title)}</div>`;
      assistantMsgEl.appendChild(currentArtifactEl);
    },
    async onActionStart(action) {
      if (!currentArtifactEl) return;
      const actionItem = document.createElement('div');
      actionItem.className = 'action-item';
      const icon = action.type === 'file' ? '📄' : '⚙️';
      const label = action.type === 'file' ? action.filePath : action.content;
      actionItem.innerHTML = `<span class="action-status">⏳</span> ${icon} <span>${escapeHtml(label || '')}</span>`;
      currentArtifactEl.appendChild(actionItem);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    },
    async onActionComplete(action) {
      if (action.type === 'file') {
        await writeFileToSandbox(action.filePath, action.content);
      } else if (action.type === 'shell') {
        await runCommand(action.content, false);
      } else if (action.type === 'start') {
        await runCommand(action.content, true);
      }
    },
    onArtifactComplete() {
      if (statusIndicator) {
        statusIndicator.textContent = webcontainerInstance ? 'Sandbox: Ready' : 'Sandbox: Direct Mode';
      }
      updateStaticPreviewFallback();
    }
  });

  try {
    const headers = { 'Content-Type': 'application/json' };
    const userGeminiKey = localStorage.getItem('gemini_api_key');
    if (userGeminiKey) headers['x-gemini-api-key'] = userGeminiKey;

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        terminalError,
        fileContext,
        conversationHistory
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Chat request failed');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(String.fromCharCode(10));
      buffer = lines.pop() || '';

      for (let rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.chunk) {
              parser.write(data.chunk);
            }
            if (data.error) {
              if (statusIndicator) {
                statusIndicator.textContent = webcontainerInstance ? "Sandbox: Ready" : "Sandbox: Direct Mode";
              }
              if (btnSend) btnSend.disabled = false;
              if (terminal) terminal.writeln(`\r
\x1b[31m[Gemini Error] ${data.error}\x1b[0m`);
              explanationEl.innerHTML += `<p style="color:#ef4444;">${escapeHtml(data.error)}</p>`;
            }
          } catch (e) {}
        }
      }
    }

    parser.end();
    if (prompt) {
      conversationHistory.push({ role: 'user', content: prompt });
    }
  } catch (err) {
    explanationEl.innerHTML += `<p style="color: #ef4444;">Error: ${escapeHtml(err.message)}</p>`;
  } finally {
    if (btnSend) btnSend.disabled = false;
    if (statusIndicator) {
      statusIndicator.textContent = webcontainerInstance ? "Sandbox: Ready" : "Sandbox: Direct Mode";
    }
  }
}

async function writeFileToSandbox(filePath, content) {
  // Always update in-memory VFS and UI
  virtualFileSystem.set(filePath, content);
  updateFileTree();

  if (currentOpenFilePath === filePath) {
    if (monacoEditor) {
      monacoEditor.setValue(content);
    } else {
      const fallback = document.getElementById('fallback-code-editor');
      if (fallback) fallback.value = content;
    }
  } else if (!currentOpenFilePath) {
    openFile(filePath);
  }

  // If WebContainer instance exists, write to WASM disk
  if (webcontainerInstance) {
    try {
      const segments = filePath.split('/');
      if (segments.length > 1) {
        const dir = segments.slice(0, -1).join('/');
        await webcontainerInstance.fs.mkdir(dir, { recursive: true });
      }
      await webcontainerInstance.fs.writeFile(filePath, content);
    } catch (e) {
      console.warn('WASM FS write warning:', e);
    }
  }
}

function updateFileTree() {
  if (!treeContent) return;
  treeContent.innerHTML = '';
  const files = Array.from(virtualFileSystem.keys()).sort();

  for (const file of files) {
    const el = document.createElement('div');
    el.className = `tree-file ${file === currentOpenFilePath ? 'active' : ''}`;
    el.textContent = file;
    el.addEventListener('click', () => openFile(file));
    treeContent.appendChild(el);
  }
}

function openFile(filePath) {
  currentOpenFilePath = filePath;
  const content = virtualFileSystem.get(filePath) || '';

  if (fileTabs) {
    fileTabs.innerHTML = `<div class="tab active">${filePath}</div>`;
  }

  if (monacoEditor) {
    const ext = filePath.split('.').pop();
    const langMap = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', html: 'html', css: 'css', json: 'json' };
    const lang = langMap[ext] || 'plaintext';
    const model = monaco.editor.createModel(content, lang);
    monacoEditor.setModel(model);
  } else {
    const fallback = document.getElementById('fallback-code-editor');
    if (fallback) fallback.value = content;
  }

  updateFileTree();
}

/**
 * Direct static & React in-browser preview compiler
 */
function updateStaticPreviewFallback() {
  if (webcontainerInstance && previewFrame.src && previewFrame.src.startsWith('http')) {
    return; // dev server is running in container
  }

  const htmlFile = virtualFileSystem.get('index.html') || virtualFileSystem.get('public/index.html');
  const cssContent = virtualFileSystem.get('src/index.css') || virtualFileSystem.get('index.css') || '';

  const jsFiles = [];
  for (const [filePath, content] of virtualFileSystem.entries()) {
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx') || filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      if (!filePath.includes('vite.config') && !filePath.includes('tailwind.config') && !filePath.includes('postcss.config')) {
        jsFiles.push({ path: filePath, content });
      }
    }
  }

  if (jsFiles.length === 0 && !htmlFile) return;

  if (previewPlaceholder) previewPlaceholder.classList.add('hidden');

  // If simple standalone HTML without React JSX
  if (htmlFile && !htmlFile.includes('src/main') && !htmlFile.includes('src/App') && jsFiles.length === 0) {
    previewFrame.srcdoc = htmlFile;
    return;
  }

  try {
    const importMap = {
      imports: {
        "react": "https://esm.sh/react@18.3.1",
        "react-dom": "https://esm.sh/react-dom@18.3.1",
        "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
        "lucide-react": "https://esm.sh/lucide-react@0.344.0",
        "canvas-confetti": "https://esm.sh/canvas-confetti@1.9.3",
        "clsx": "https://esm.sh/clsx@2.1.1",
        "tailwind-merge": "https://esm.sh/tailwind-merge@2.3.0"
      }
    };

    for (const file of jsFiles) {
      let code = file.content;
      if (window.Babel) {
        try {
          const transpiled = window.Babel.transform(code, {
            presets: [['react', { runtime: 'classic' }]]
          }).code;
          code = transpiled;
        } catch (err) {
          console.warn('Babel error in ' + file.path + ':', err);
        }
      }

      const blob = new Blob([code], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);

      const norm = file.path.replace(/^\.?\/?/, '');
      importMap.imports['/' + norm] = blobUrl;
      importMap.imports['./' + norm] = blobUrl;
      importMap.imports[norm] = blobUrl;

      const baseName = norm.split('/').pop().replace(/\.[^/.]+$/, '');
      importMap.imports['./' + baseName] = blobUrl;
      importMap.imports['./' + baseName + '.jsx'] = blobUrl;
      importMap.imports['./' + baseName + '.js'] = blobUrl;
      importMap.imports['./components/' + baseName] = blobUrl;
      importMap.imports['./components/' + baseName + '.jsx'] = blobUrl;
      importMap.imports['./data/' + baseName] = blobUrl;
      importMap.imports['./data/' + baseName + '.js'] = blobUrl;
    }

    // 1. Pick or synthesize root App component
    let entryBlobUrl = blobUrls['src/App.jsx'] || blobUrls['src/main.jsx'] || blobUrls['src/App.tsx'];

    if (!entryBlobUrl) {
      // Find all component files
      const componentFiles = jsFiles.filter(f => f.path.includes('components/') || (f.path.endsWith('.jsx') && !f.path.includes('vite.config')));
      const compImports = componentFiles.map((cf, i) => {
        const norm = cf.path.replace(/^\.?\/?/, '');
        return 'import Comp' + i + ' from "./' + norm + '";';
      }).join(String.fromCharCode(10));

      const compRenders = componentFiles.map((cf, i) => '<Comp' + i + ' />').join(String.fromCharCode(10) + '        ');

      let syntheticCode = 'import React from "react";' + String.fromCharCode(10) +
        compImports + String.fromCharCode(10) + String.fromCharCode(10) +
        'export default function App() {' + String.fromCharCode(10) +
        '  return (' + String.fromCharCode(10) +
        '    <div className="min-h-screen bg-slate-900 text-white">' + String.fromCharCode(10) +
        '      ' + (compRenders || '<div className="p-8 text-center text-xl font-bold">Rendering application...</div>') + String.fromCharCode(10) +
        '    </div>' + String.fromCharCode(10) +
        '  );' + String.fromCharCode(10) +
        '}';

      if (window.Babel) {
        try {
          syntheticCode = window.Babel.transform(syntheticCode, { presets: [['react', { runtime: 'classic' }]] }).code;
        } catch (e) {}
      }

      const synBlob = URL.createObjectURL(new Blob([syntheticCode], { type: 'application/javascript' }));
      blobUrls['src/App.jsx'] = synBlob;
      importMap.imports['./src/App.jsx'] = synBlob;
      importMap.imports['src/App.jsx'] = synBlob;
      importMap.imports['./App.jsx'] = synBlob;
      importMap.imports['./App'] = synBlob;
      entryBlobUrl = synBlob;
    }

    const cleanCss = cssContent.split('@tailwind').join('/* @tailwind */');

    const compiledHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    ${cleanCss}
  </style>
  <script type="importmap">
    ${JSON.stringify(importMap, null, 2)}
  </script>
</head>
<body class="bg-slate-900 text-white min-h-screen">
  <div id="root"></div>
  <script type="module">
    import React from 'react';
    import ReactDOM from 'react-dom/client';

    try {
      const mod = await import('${entryBlobUrl}');
      const Component = mod.default || mod.App || mod.Hero || mod.Navbar || mod[Object.keys(mod)[0]];
      if (Component && !document.getElementById('root').hasChildNodes()) {
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(Component));
      }
    } catch (err) {
      console.error('Preview error:', err);
      document.getElementById('root').innerHTML = '<div style="padding:1.5rem;color:#f87171;font-family:monospace;font-size:13px;"><h3>Live Preview Error</h3><pre>' + err.message + '</pre></div>';
    }
  </script>
</body>
</html>`;

    previewFrame.srcdoc = compiledHtml;
  } catch (err) {
    console.error('Preview compilation failed:', err);
  }
}

function appendUserMessage(text) {
  const msgEl = document.createElement('div');
  msgEl.className = 'message user';
  msgEl.textContent = text;
  chatMessages?.appendChild(msgEl);
  if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render Instant Deployment Integration
 */
btnDeploy?.addEventListener('click', () => {
  deployModal?.classList.remove('hidden');
  deploySuccessBox?.classList.add('hidden');
  deployStatusBox?.classList.add('hidden');
  if (deployProjectName) {
    deployProjectName.value = 'app-' + Math.random().toString(36).substring(2, 7);
  }
});

btnCloseDeploy?.addEventListener('click', () => deployModal?.classList.add('hidden'));

btnConfirmDeploy?.addEventListener('click', async () => {
  const name = deployProjectName?.value?.trim() || 'my-app';
  const renderApiKey = localStorage.getItem('render_api_key');

  deployStatusBox?.classList.remove('hidden');
  if (btnConfirmDeploy) btnConfirmDeploy.disabled = true;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (renderApiKey) headers['x-render-api-key'] = renderApiKey;

    const res = await fetch('/api/deploy', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        projectName: name,
        buildCommand: 'npm run build',
        publishPath: 'dist'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Deployment initiation failed');

    if (deployStatusText) {
      deployStatusText.textContent = `Service created: ${data.name}. Provisioning global CDN...`;
    }

    setTimeout(() => {
      deployStatusBox?.classList.add('hidden');
      deploySuccessBox?.classList.remove('hidden');
      if (deployLiveUrl) {
        deployLiveUrl.href = data.url;
        deployLiveUrl.textContent = data.url;
      }
      if (btnConfirmDeploy) btnConfirmDeploy.disabled = false;
    }, 4000);
  } catch (err) {
    if (deployStatusText) {
      deployStatusText.textContent = `Deploy error: ${err.message}`;
    }
    if (btnConfirmDeploy) btnConfirmDeploy.disabled = false;
  }
});

/**
 * Client Artifact Parser implementation
 */
class ClientArtifactParser {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.buffer = '';
    this.currentIndex = 0;
    this.currentArtifact = null;
    this.currentAction = null;
    this.extractedFiles = new Set();
  }

  write(chunk) {
    this.buffer += chunk;
    this._process();
  }

  _process() {
    while (this.currentIndex < this.buffer.length) {
      if (!this.currentArtifact) {
        // Flexible case-insensitive match for <boltArtifact ...>
        const artifactMatch = this.buffer.slice(this.currentIndex).match(/<boltArtifact\b([^>]*)>/i);
        if (artifactMatch) {
          const matchIndex = this.currentIndex + artifactMatch.index;
          const preText = this.buffer.slice(this.currentIndex, matchIndex);
          if (preText) this.callbacks.onExplanationChunk(preText);

          const attrs = artifactMatch[1] || '';
          const id = (attrs.match(/\bid=["']?([^"'\s>]+)["']?/i) || [])[1] || 'web-app';
          const title = (attrs.match(/\btitle=["']?([^"'>]+)["']?/i) || [])[1] || 'Generated Project';

          this.currentArtifact = { id, title };
          this.callbacks.onArtifactStart(this.currentArtifact);
          this.currentIndex = matchIndex + artifactMatch[0].length;
        } else {
          // Check for code blocks in remaining text
          const remaining = this.buffer.slice(this.currentIndex);
          const partialTag = remaining.lastIndexOf('<boltArtifact');
          if (partialTag !== -1) {
            const pre = remaining.slice(0, partialTag);
            if (pre) this.callbacks.onExplanationChunk(pre);
            this.currentIndex += partialTag;
            break;
          } else {
            this._checkMarkdownFiles(remaining);
            break;
          }
        }
      } else if (!this.currentAction) {
        const remaining = this.buffer.slice(this.currentIndex);
        const artEndMatch = remaining.match(/<\/boltArtifact\s*>/i);
        const actMatch = remaining.match(/<boltAction\b([^>]*)>/i);

        if (actMatch && (!artEndMatch || actMatch.index < artEndMatch.index)) {
          const attrs = actMatch[1] || '';
          const type = (attrs.match(/\btype=["']?([a-z0-9_-]+)["']?/i) || [])[1] || 'file';
          const filePath = (attrs.match(/\b(?:filePath|path)=["']?([^"'\s>]+)["']?/i) || [])[1] || null;

          this.currentAction = { type, filePath, content: '' };
          this.callbacks.onActionStart(this.currentAction);
          this.currentIndex += actMatch.index + actMatch[0].length;
        } else if (artEndMatch) {
          this.callbacks.onArtifactComplete(this.currentArtifact);
          this.currentIndex += artEndMatch.index + artEndMatch[0].length;
          this.currentArtifact = null;
        } else {
          break;
        }
      } else {
        const remaining = this.buffer.slice(this.currentIndex);
        const endMatch = remaining.match(/<\/boltAction\s*>|(?=<boltAction\b)|(?=<\/boltArtifact\s*>)/i);

        if (endMatch) {
          this.currentAction.content += remaining.slice(0, endMatch.index);
          this.currentAction.content = this._cleanActionContent(this.currentAction.content);
          this.callbacks.onActionComplete(this.currentAction);

          let skipLen = endMatch[0].length;
          this.currentIndex += endMatch.index + skipLen;
          this.currentAction = null;
        } else {
          const partialEnd = remaining.lastIndexOf('</');
          if (partialEnd !== -1) {
            this.currentAction.content += remaining.slice(0, partialEnd);
            this.currentIndex += partialEnd;
            break;
          } else {
            this.currentAction.content += remaining;
            this.currentIndex = this.buffer.length;
          }
        }
      }
    }
  }

  _cleanActionContent(content) {
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      const firstLineEnd = cleaned.indexOf(String.fromCharCode(10));
      if (firstLineEnd !== -1) {
        cleaned = cleaned.slice(firstLineEnd + 1);
      }
      const lastLineStart = cleaned.lastIndexOf('```');
      if (lastLineStart !== -1) {
        cleaned = cleaned.slice(0, lastLineStart);
      }
    }
    return cleaned.trim();
  }

  _checkMarkdownFiles(text) {
    const fileRegex = new RegExp('(?:###?\s*`?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`?|File:\s*`?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`?|```[a-zA-Z0-9_-]*\s+(?:filePath=)?["\x27]?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)["\x27]?)[\s\S]*?```[a-zA-Z0-9_-]*[\r\n]+([\s\S]*?)```', 'g');
    let match;
    while ((match = fileRegex.exec(text)) !== null) {
      const filePath = match[1] || match[2] || match[3];
      const content = match[4];
      if (filePath && content && !this.extractedFiles.has(filePath)) {
        this.extractedFiles.add(filePath);
        if (!this.currentArtifact) {
          this.callbacks.onArtifactStart({ id: 'app', title: 'Extracted Project' });
        }
        this.callbacks.onActionStart({ type: 'file', filePath, content });
        this.callbacks.onActionComplete({ type: 'file', filePath, content });
      }
    }
    this.callbacks.onExplanationChunk(text);
    this.currentIndex = this.buffer.length;
  }

  end() {
    if (this.currentIndex < this.buffer.length) {
      if (!this.currentArtifact) {
        this._checkMarkdownFiles(this.buffer.slice(this.currentIndex));
      } else if (this.currentAction) {
        this.currentAction.content += this.buffer.slice(this.currentIndex);
        this.currentAction.content = this._cleanActionContent(this.currentAction.content);
        this.callbacks.onActionComplete(this.currentAction);
        this.currentAction = null;
      }
      this.currentIndex = this.buffer.length;
    }
  }
}
