const http = require('http');

class VaultClient {
  constructor(config) {
    const host = config.host || 'vault-service';
    const port = config.port || 8300;
    this.baseUrl = `http://${host}:${port}`;
    this.serviceName = config.serviceName;
    this.token = config.token;
  }

  async getSecret(path) {
    const response = await this.makeRequest(`/api/secrets/${path}`);
    if (!response.success) {
      throw new Error(`Failed to get secret: ${response.error}`);
    }
    return response.data;
  }

  async getDatabaseConfig() {
    const response = await this.makeRequest('/api/database/config');
    if (!response.success) {
      throw new Error(`Failed to get database config: ${response.error}`);
    }
    return response.data;
  }

  async getServiceUrls() {
    const response = await this.makeRequest('/api/services/urls');
    if (!response.success) {
      throw new Error(`Failed to get service URLs: ${response.error}`);
    }
    return response.data;
  }

  async getDatabaseUrl(database) {
    const dbConfig = await this.getDatabaseConfig();
    return dbConfig.getDatabaseUrl(database);
  }

  async waitForVault(maxRetries = 30) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.makeHealthRequest();
        console.log(`✅ Vault service is ready for ${this.serviceName}`);
        return;
      } catch (error) {
        console.log(`⏳ Waiting for Vault service... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    throw new Error('Vault service is not available after maximum retries');
  }

  makeHealthRequest() {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}/health`);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`Health check failed: ${res.statusCode}`));
        }
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Health check timeout'));
      });

      req.end();
    });
  }

  makeRequest(endpoint, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${endpoint}`);
      const postData = options.body ? JSON.stringify(options.body) : undefined;

      const requestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(postData && { 'Content-Length': Buffer.byteLength(postData) }),
          ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
          ...options.headers
        }
      };

      const req = http.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(jsonData);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${jsonData.error || res.statusMessage}`));
            }
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      });

      req.on('error', reject);

      if (postData) {
        req.write(postData);
      }

      req.end();
    });
  }
}

// Helper function to create environment variables from secrets
async function loadEnvFromVault(serviceName) {
  const vaultClient = new VaultClient({ serviceName });

  try {
    await vaultClient.waitForVault();

    // Load database config
    const dbConfig = await vaultClient.getDatabaseConfig();
    process.env.DATABASE_URL = dbConfig.getDatabaseUrl(getServiceDatabase(serviceName));

    // Load service URLs
    const serviceUrls = await vaultClient.getServiceUrls();
    process.env.AUTH_SERVICE_URL = serviceUrls.auth_service_url;
    process.env.USER_SERVICE_URL = serviceUrls.user_service_url;
    process.env.GAME_SERVICE_URL = serviceUrls.game_service_url;
    process.env.GATEWAY_SERVICE_URL = serviceUrls.gateway_service_url;

    // Load JWT secrets for auth service
    if (serviceName === 'auth-service') {
      const jwtSecrets = await vaultClient.getSecret('jwt');
      process.env.JWT_SECRET = jwtSecrets.secret;
      process.env.JWT_ALGORITHM = jwtSecrets.algorithm;
      process.env.JWT_EXPIRATION = jwtSecrets.expiration;
    }

    // Load API configuration
    const apiConfig = await vaultClient.getSecret('api');
    process.env.RATE_LIMIT_MAX = apiConfig.rate_limit_max;
    process.env.RATE_LIMIT_WINDOW = apiConfig.rate_limit_window;
    process.env.CORS_ORIGIN = apiConfig.cors_origin;

    // Load game configuration for game service
    if (serviceName === 'game-service') {
      const gameConfig = await vaultClient.getSecret('game');
      process.env.WS_HEARTBEAT_INTERVAL = gameConfig.ws_heartbeat_interval;
      process.env.WS_CONNECTION_TIMEOUT = gameConfig.ws_connection_timeout;
      process.env.GAME_TICK_RATE = gameConfig.game_tick_rate;
      process.env.MATCH_TIMEOUT = gameConfig.match_timeout;
      process.env.MATCHMAKING_TIMEOUT = gameConfig.matchmaking_timeout;
      process.env.PORT = '3002';
    }

    // Load port configuration
    if (serviceName === 'auth-service') {
      process.env.PORT = '3000';
    } else if (serviceName === 'user-service') {
      process.env.PORT = '3001';
    } else if (serviceName === 'gateway-service') {
      process.env.PORT = '3003';
    }

    console.log(`✅ Environment variables loaded from Vault for ${serviceName}`);
  } catch (error) {
    console.error(`❌ Failed to load environment from Vault for ${serviceName}:`, error);
    throw error;
  }
}

function getServiceDatabase(serviceName) {
  const dbMap = {
    'auth-service': 'auth_db',
    'user-service': 'user_db',
    'game-service': 'game_db'
  };
  return dbMap[serviceName] || 'transcendence';
}

module.exports = {
  VaultClient,
  loadEnvFromVault
};
