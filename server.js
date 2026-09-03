import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { BOLT_SYSTEM_PROMPT, createAgentTurnMessage } from './src/lib/gemini-prompt.js';
import { RenderClient } from './src/lib/render-deploy.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// CRITICAL: WebContainers require Cross-Origin Isolation headers to use SharedArrayBuffer
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

// Serve frontend static assets
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Vendor proxy for @webcontainer/api
 * Serves same-origin with CORP headers to prevent COEP from blocking it in the browser
 */
app.get('/vendor/webcontainer.js', async (req, res) => {
  try {
    const upstream = await fetch('https://cdn.jsdelivr.net/npm/@webcontainer/api@1.5.1/dist/index.js');
    if (!upstream.ok) {
      throw new Error(`Upstream returned ${upstream.status}`);
    }
    const script = await upstream.text();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(script);
  } catch (err) {
    console.error('Failed to proxy webcontainer:', err);
    res.status(502).send(`// Error proxying webcontainer: ${err.message}`);
  }
});

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    renderConfigured: !!process.env.RENDER_API_KEY
  });
});

/**
 * Streaming Gemini AI Chat Endpoint
 * Uses Gemini API Server-Sent Events (SSE) to stream tokens directly to the browser
 */
app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY || req.headers['x-gemini-api-key'];
  if (!apiKey) {
    return res.status(400).json({ error: 'GEMINI_API_KEY is missing. Configure it in .env or pass x-gemini-api-key header.' });
  }

  const { prompt, fileContext, terminalError, model = 'gemini-flash-latest', conversationHistory = [] } = req.body;

  if (!prompt && !terminalError) {
    return res.status(400).json({ error: 'Prompt or terminal error is required.' });
  }

  // Construct turn message
  const userContent = createAgentTurnMessage({ prompt, fileContext, terminalError });

  // Prepare Gemini payload
  const contents = [
    ...conversationHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    })),
    {
      role: 'user',
      parts: [{ text: userContent }]
    }
  ];

  const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const response = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: BOLT_SYSTEM_PROMPT }]
        },
        contents,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      res.write(`data: ${JSON.stringify({ error: `Gemini API error: ${errText}` })}${LF}${LF}`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(LF);
      buffer = lines.pop() || '';

      for (let rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const textChunk = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textChunk) {
              res.write(`data: ${JSON.stringify({ chunk: textChunk })}${LF}${LF}`);
            }
          } catch (e) {
            // Ignore parse errors from SSE control frames
          }
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}${LF}${LF}`);
    res.end();
  } catch (err) {
    console.error('Chat endpoint error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}${LF}${LF}`);
    res.end();
  }
});

/**
 * Render Instant Deployment Endpoint
 */
app.post('/api/deploy', async (req, res) => {
  const apiKey = process.env.RENDER_API_KEY || req.headers['x-render-api-key'];
  if (!apiKey) {
    return res.status(400).json({ error: 'RENDER_API_KEY is missing. Configure it in .env or pass x-render-api-key header.' });
  }

  const { projectName, repoUrl, branch = 'main', buildCommand, publishPath } = req.body;

  try {
    const render = new RenderClient(apiKey);
    const owners = await render.getOwners();
    if (!owners || owners.length === 0) {
      return res.status(400).json({ error: 'No Render owner account found for this API key.' });
    }

    const ownerId = owners[0].owner.id;

    // Create Static Site on Render
    const service = await render.createStaticSite({
      ownerId,
      name: projectName || 'bolt-project-' + Date.now(),
      repoUrl: repoUrl || 'https://github.com/render-examples/vite-react-template',
      branch,
      buildCommand: buildCommand || 'npm run build',
      publishPath: publishPath || 'dist'
    });

    res.json({
      success: true,
      serviceId: service.service.id,
      name: service.service.name,
      url: service.service.serviceDetails?.url || `https://${service.service.name}.onrender.com`
    });
  } catch (err) {
    console.error('Deployment error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Check Render Deployment Status
 */
app.get('/api/deploy/status/:serviceId', async (req, res) => {
  const apiKey = process.env.RENDER_API_KEY || req.headers['x-render-api-key'];
  if (!apiKey) {
    return res.status(400).json({ error: 'RENDER_API_KEY is missing.' });
  }

  try {
    const render = new RenderClient(apiKey);
    const service = await render.getService(req.params.serviceId);
    res.json({
      id: service.id,
      name: service.name,
      status: service.suspended ? 'suspended' : 'active',
      url: service.serviceDetails?.url
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`⚡ Bolt Gemini Platform listening on http://localhost:${PORT}`);
});
