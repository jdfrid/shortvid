const API_ORIGIN = (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
const API_BASE = API_ORIGIN ? `${API_ORIGIN}/api` : '/api';

class ApiService {
  constructor() {
    this.token = localStorage.getItem('token');
  }

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
  }

  getToken() {
    return this.token || localStorage.getItem('token');
  }

  async request(endpoint, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const allowGatewayRetry = method === 'GET' || method === 'HEAD';
    const maxAttempts = allowGatewayRetry ? 3 : 1;

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    if (this.getToken()) headers.Authorization = `Bearer ${this.getToken()}`;

    const url = `${API_BASE}${endpoint}`;
    let response;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1300 * attempt));
      try {
        response = await fetch(url, { ...options, headers });
      } catch (netErr) {
        if (!allowGatewayRetry || attempt === maxAttempts - 1) throw netErr;
        continue;
      }
      if (response.status === 401) {
        this.setToken(null);
        window.location.href = '/login';
        throw new Error('Unauthorized');
      }
      const gateway = response.status === 502 || response.status === 503 || response.status === 504;
      if (allowGatewayRetry && gateway && attempt < maxAttempts - 1) continue;
      break;
    }

    const raw = await response.text();
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(raw.slice(0, 120) || `HTTP ${response.status}`);
      }
    }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  async login(email, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (data.token) this.setToken(data.token);
    return data;
  }

  async getProfile() {
    return this.request('/auth/profile');
  }

  async getCreativeStudioSettings() {
    return this.request('/creative/settings');
  }

  async saveCreativeStudioSettings(body) {
    return this.request('/creative/settings', { method: 'PUT', body: JSON.stringify(body) });
  }

  async getCreativeVideoOptions() {
    return this.request('/creative/options');
  }

  async getCreativeVideoStatus() {
    return this.request('/creative/status');
  }

  async getCreativeVideoJobs(limit = 40) {
    return this.request(`/creative/jobs?limit=${limit}`);
  }

  async getCreativeVideoJob(id) {
    return this.request(`/creative/jobs/${id}`);
  }

  async createCreativeVideoJob(body) {
    return this.request('/creative/jobs', { method: 'POST', body: JSON.stringify(body) });
  }

  async retryCreativeVideoJob(jobId) {
    return this.request(`/creative/jobs/${jobId}/retry`, { method: 'POST', body: JSON.stringify({}) });
  }
}

export default new ApiService();
