interface VaultConfig {
  host?: string;
  port?: number;
  serviceName: string;
  token?: string;
}

interface SecretData {
  [key: string]: any;
}

export class VaultClient {
  private baseUrl: string;
  private serviceName: string;
  private token?: string;

  constructor(config: VaultConfig) {
    const host = config.host || 'vault-service';
    const port = config.port || 8300;
    this.baseUrl = `http://${host}:${port}`;
    this.serviceName = config.serviceName;
    this.token = config.token;
  }

  async getSecret(path: string): Promise<SecretData> {
    const response = await this.makeRequest(`/api/secrets/${path}`);
    if (!response.success) {
      throw new Error(`Failed to get secret: ${response.error}`);
    }
    return response.data;
  }

  async getDatabaseConfig(): Promise<any> {
    const response = await this.makeRequest('/api/database/config');
    if (!response.success) {
      throw new Error(`Failed to get database config: ${response.error}`);
    }
    return response.data;
  }

  async getServiceUrls(): Promise<any> {
    const response = await this.makeRequest('/api/services/urls');
    if (!response.success) {
      throw new Error(`Failed to get service URLs: ${response.error}`);
    }
    return response.data;
  }

  async getDatabaseUrl(database: string): Promise<string> {
    const dbConfig = await this.getDatabaseConfig();
    return dbConfig.getDatabaseUrl(database);
  }

  async waitForVault(maxRetries = 30): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`${this.baseUrl}/health`);
        if (response.ok) {
          console.log(`✅ Vault service is ready for ${this.serviceName}`);
          return;
        }
      } catch (error) {
        console.log(`⏳ Waiting for Vault service... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    throw new Error('Vault service is not available after maximum retries');
  }

  private async makeRequest(endpoint: string, options: any = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: { [key: string]: string } = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Error making request to ${url}:`, error);
      throw error;
    }
  }
}

// Helper function to create environment variables from secrets
export async function loadEnvFromVault(serviceName: string): Promise<void> {
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
      // Variables de sécurité pour HSTS
      process.env.FORCE_HTTPS = gameConfig.force_https;
      process.env.HSTS_MAX_AGE = gameConfig.hsts_max_age;
      process.env.SECURITY_HEADERS = gameConfig.security_headers;
    }

    console.log(`✅ Environment variables loaded from Vault for ${serviceName}`);
  } catch (error) {
    console.error(`❌ Failed to load environment from Vault for ${serviceName}:`, error);
    throw error;
  }
}

function getServiceDatabase(serviceName: string): string {
  const dbMap: { [key: string]: string } = {
    'auth-service': 'auth_db',
    'user-service': 'user_db',
    'game-service': 'game_db'
  };
  return dbMap[serviceName] || 'transcendence';
}

export default VaultClient;
