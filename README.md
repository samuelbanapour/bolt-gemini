# Bolt.gemini ⚡

A web development platform inspired by **Bolt.new** and **Bolt.host**, powered by **Google Gemini API** for code generation and **Render** for instant cloud deployment.

---

## 🏗️ Architecture

Bolt.gemini unites three core systems into a cohesive in-browser development environment:

```
┌─────────────────────────────────────────────────────────────┐
│                       Browser Client                        │
│ ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐ │
│ │  Gemini Chat  │  │ Monaco Editor │  │   Live Preview    │ │
│ │  Agent Panel  │  │  + File Tree  │  │ (Iframe / Port)   │ │
│ └───────┬───────┘  └───────▲───────┘  └─────────▲─────────┘ │
│         │                  │                    │           │
│         ▼                  ▼                    │           │
│ ┌───────────────────────────────────────────────┴─────────┐ │
│ │               StackBlitz WebContainer API               │ │
│ │       (Node.js runtime, npm, Vite dev server in WASM)   │ │
│ └──────────────────────────┬──────────────────────────────┘ │
└────────────────────────────┼────────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│     Gemini API Proxy    │       │     Render Deploy API   │
│  (SSE Streaming Stream) │       │   (Instant Cloud Host)  │
├─────────────────────────┤       ├─────────────────────────┤
│ • Model: Gemini 2.0     │       │ • Package build artifacts│
│ • Artifact XML Parser   │       │ • Render REST API v1    │
│ • Self-healing error ctx│       │ • Provision live URL    │
└─────────────────────────┘       └────────────┬────────────┘
                                               │
                                               ▼
                                  ┌─────────────────────────┐
                                  │   Render Global Cloud   │
                                  │ (*.onrender.com URL)    │
                                  └─────────────────────────┘
```

---

## ⚡ Gemini Artifact Protocol

Gemini communicates file updates and shell commands to the in-browser sandbox via structured XML:

```xml
<boltArtifact id="project-init" title="Scaffold Vite React App">
  <!-- 1. Create or overwrite files -->
  <boltAction type="file" filePath="package.json">
  {
    "name": "vite-app",
    "version": "1.0.0",
    "scripts": { "dev": "vite", "build": "vite build" },
    "dependencies": { "react": "^18.3.1", "react-dom": "^18.3.1" },
    "devDependencies": { "@vitejs/plugin-react": "^4.3.1", "vite": "^5.4.2" }
  }
  </boltAction>

  <!-- 2. Execute setup / install commands -->
  <boltAction type="shell">
  npm install
  </boltAction>

  <!-- 3. Launch the development server -->
  <boltAction type="start">
  npm run dev
  </boltAction>
</boltArtifact>
```

The frontend uses `ClientArtifactParser` to parse these XML tags **on the fly as tokens stream in from Gemini**, writing files to the WebContainer filesystem and triggering shell commands immediately.

---

## 🔐 Cross-Origin Isolation (WebContainers Requirement)

WebContainers run Node.js in WebAssembly using `SharedArrayBuffer`. Browsers mandate Cross-Origin Isolation headers:

- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Opener-Policy: same-origin`

These headers are pre-configured in `server.js` and `render.yaml`.

---

## 🚀 Quickstart

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in:
- `GEMINI_API_KEY`: Your key from [Google AI Studio](https://aistudio.google.com/).
- `RENDER_API_KEY`: (Optional) Your key from Render Dashboard > Account Settings > API Keys.

*(Note: API keys can also be supplied directly in the web UI via the **Settings ⚙️** modal).*

### 3. Start the Platform
```bash
npm start
```
Open **http://localhost:3000** in your browser.

---

## 📁 Project Structure

```
bolt-gemini/
├── server.js               # Express server with COOP/COEP isolation & SSE proxy
├── render.yaml             # Render Blueprint for hosting this platform
├── package.json
├── .env.example
├── src/
│   └── lib/
│       ├── gemini-prompt.js   # Gemini agent prompt & turn constructor
│       ├── artifact-parser.js # Streaming XML artifact parser
│       └── render-deploy.js   # Render REST API v1 deployment client
└── public/
    ├── index.html          # 3-pane IDE UI (Chat, Monaco, Live Preview/Terminal)
    ├── style.css           # Modern dark-mode IDE styling
    └── app.js              # WebContainer controller, Monaco & xterm integration
```
