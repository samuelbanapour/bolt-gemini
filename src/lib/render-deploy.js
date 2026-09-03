/**
 * Render Instant Deployment Client
 * 
 * Provides automated service creation and instant deployment capabilities
 * via the Render REST API (v1).
 */

const RENDER_API_BASE = 'https://api.render.com/v1';

export class RenderClient {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('Render API key is required');
    }
    this.apiKey = apiKey;
    this.headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  }

  /**
   * Retrieves user/owner details needed to create services.
   */
  async getOwners() {
    const res = await fetch(`${RENDER_API_BASE}/owners?limit=20`, {
      headers: this.headers
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to fetch Render owners: ${err}`);
    }
    return res.json();
  }

  /**
   * Creates a new Static Site service on Render.
   */
  async createStaticSite({ ownerId, name, repoUrl, branch = 'main', buildCommand = 'npm run build', publishPath = 'dist' }) {
    const payload = {
      type: 'static_site',
      name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32),
      ownerId,
      repo: repoUrl,
      branch,
      serviceDetails: {
        buildCommand,
        publishPath
      }
    };

    const res = await fetch(`${RENDER_API_BASE}/services`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to create Render static site: ${err}`);
    }

    return res.json();
  }

  /**
   * Triggers a new deployment for an existing service.
   */
  async triggerDeploy({ serviceId, clearCache = 'do_not_clear' }) {
    const res = await fetch(`${RENDER_API_BASE}/services/${serviceId}/deploys`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ clearCache })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to trigger deploy on Render: ${err}`);
    }

    return res.json();
  }

  /**
   * Retrieves deploy status.
   */
  async getDeployStatus({ serviceId, deployId }) {
    const res = await fetch(`${RENDER_API_BASE}/services/${serviceId}/deploys/${deployId}`, {
      headers: this.headers
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to get deploy status: ${err}`);
    }

    return res.json();
  }

  /**
   * Retrieves service metadata (including its public *.onrender.com URL).
   */
  async getService(serviceId) {
    const res = await fetch(`${RENDER_API_BASE}/services/${serviceId}`, {
      headers: this.headers
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to get service details: ${err}`);
    }

    return res.json();
  }
}
