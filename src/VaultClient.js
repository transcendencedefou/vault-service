const http = require('http');
const SecretManager = require('./SecretManager');

/**
 * Client pour interagir avec le service Vault de Transcendence
 * Implémente les meilleures pratiques de sécurité
 */
class VaultClient {
  constructor(config) {
    const host = config.host || 'vault-service';
    const port = config.port || 8300;
    this.baseUrl = `http://${host}:${port}`;
    this.serviceName = config.serviceName;
    this.token = config.token;
    this.timeout = config.timeout || 10000; // 10s timeout
    this.retryCount = config.retryCount || 3;
  }

  /**
   * Récupère un secret depuis Vault avec retry et logging sécurisé
   * @param {string} path - Chemin du secret
   * @returns {Promise<Object>} Données du secret
   */
  async getSecret(path) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.retryCount; attempt++) {
      try {
        const response = await this.makeRequest(`/api/secrets/${path}`);
        if (!response.success) {
          throw new Error(`Failed to get secret: ${response.error}`);
        }
        
        // Log sécurisé sans exposer le secret
        console.log(`✅ Secret retrieved from path: ${path} (attempt ${attempt})`);
        return response.data;
        
      } catch (error) {
        lastError = error;
        if (attempt < this.retryCount) {
          console.warn(`⚠️ Secret retrieval failed (attempt ${attempt}/${this.retryCount}), retrying...`);
          await this.sleep(1000 * attempt); // Exponential backoff
        }
      }
    }
    
    console.error(`❌ Failed to retrieve secret from ${path} after ${this.retryCount} attempts`);
    throw lastError;
  }

  /**
   * Récupère la configuration de la base de données
   * @returns {Promise<Object>} Configuration de la DB
   */
  async getDatabaseConfig() {
    const response = await this.makeRequest('/api/database/config');
    if (!response.success) {
      throw new Error(`Failed to get database config: ${response.error}`);
    }
    return response.data;
  }

  /**
   * Récupère les URLs des services
   * @returns {Promise<Object>} URLs des services
   */
  async getServiceUrls() {
    const response = await this.makeRequest('/api/services/urls');
    if (!response.success) {
      throw new Error(`Failed to get service URLs: ${response.error}`);
    }
    return response.data;
  }

  /**
   * Récupère l'URL complète de la base de données pour un service
   * @param {string} database - Nom de la base de données
   * @returns {Promise<string>} URL de connexion
   */
  async getDatabaseUrl(database) {
    const dbConfig = await this.getDatabaseConfig();
    return dbConfig.getDatabaseUrl(database);
  }

  /**
   * Attend que le service Vault soit prêt avec retry exponentiel
   * @param {number} maxRetries - Nombre maximum de tentatives
   * @returns {Promise<void>}
   */
  async waitForVault(maxRetries = 30) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.makeHealthRequest();
        console.log(`✅ Vault service is ready for ${this.serviceName}`);
        return;
      } catch (error) {
        const waitTime = Math.min(1000 * Math.pow(1.5, i), 10000); // Exponential backoff, max 10s
        console.log(`⏳ Waiting for Vault service... (${i + 1}/${maxRetries}) - retry in ${waitTime}ms`);
        await this.sleep(waitTime);
      }
    }
    throw new Error('Vault service is not available after maximum retries');
  }

  /**
   * Utilitaire pour pause
   * @param {number} ms - Millisecondes
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Effectue une requête de santé vers le service Vault
   * @returns {Promise<void>}
   */
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

  /**
   * Effectue une requête HTTP vers le service Vault
   * @param {string} endpoint - Endpoint à appeler
   * @param {Object} options - Options de la requête
   * @returns {Promise<Object>} Réponse JSON
   */
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

/**
 * Charge les variables d'environnement depuis Vault pour un service
 * Implémente la sécurité et la validation
 * @param {string} serviceName - Nom du service
 * @returns {Promise<void>}
 */
async function loadEnvFromVault(serviceName) {
  const vaultClient = new VaultClient({ serviceName });

  try {
    console.log(`🔐 Loading environment variables for ${serviceName} from Vault...`);
    await vaultClient.waitForVault();

    // Configuration de la base de données avec validation
    try {
      const dbConfig = await vaultClient.getDatabaseConfig();
      const dbUrl = dbConfig.getDatabaseUrl(getServiceDatabase(serviceName));
      
      // Valider l'URL de base de données
      if (!dbUrl || !dbUrl.startsWith('mysql://')) {
        throw new Error('Invalid database URL format');
      }
      
      process.env.DATABASE_URL = dbUrl;
      console.log(`✅ Database configuration loaded for ${getServiceDatabase(serviceName)}`);
    } catch (error) {
      console.warn(`⚠️ Failed to load database config from Vault: ${error.message}`);
      // Fallback sera géré par le service
    }

    // URLs des services avec validation
    try {
      const serviceUrls = await vaultClient.getServiceUrls();
      
      // Validation et assignation sécurisée
      const urlMap = {
        AUTH_SERVICE_URL: serviceUrls.auth_service_url,
        USER_SERVICE_URL: serviceUrls.user_service_url,
        GAME_SERVICE_URL: serviceUrls.game_service_url,
        GATEWAY_SERVICE_URL: serviceUrls.gateway_service_url
      };

      for (const [envVar, url] of Object.entries(urlMap)) {
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          process.env[envVar] = url;
        }
      }
      
      console.log('✅ Service URLs loaded from Vault');
    } catch (error) {
      console.warn(`⚠️ Failed to load service URLs from Vault: ${error.message}`);
    }

    // Secrets JWT pour le service d'auth avec validation
    if (serviceName === 'auth-service') {
      try {
        const jwtSecrets = await vaultClient.getSecret('jwt');
        
        // Validation des secrets JWT
        if (jwtSecrets.secret && jwtSecrets.secret.length >= 32) {
          process.env.JWT_SECRET = jwtSecrets.secret;
          process.env.JWT_ALGORITHM = jwtSecrets.algorithm || 'HS256';
          process.env.JWT_EXPIRATION = jwtSecrets.expiration || '24h';
          
          console.log(`✅ JWT secrets loaded (algorithm: ${jwtSecrets.algorithm})`);
        } else {
          throw new Error('JWT secret too short or missing');
        }
      } catch (error) {
        console.warn(`⚠️ Failed to load JWT secrets: ${error.message}`);
        // Générer un fallback temporaire pour le développement
        console.warn('🔧 Generating temporary JWT secret for development');
        process.env.JWT_SECRET = SecretManager.generateSecureToken(32);
        process.env.JWT_ALGORITHM = 'HS256';
        process.env.JWT_EXPIRATION = '24h';
      }
    }

    // Configuration API avec validation
    try {
      const apiConfig = await vaultClient.getSecret('api');
      
      // Validation et assignation
      process.env.RATE_LIMIT_MAX = String(parseInt(apiConfig.rate_limit_max) || 100);
      process.env.RATE_LIMIT_WINDOW = String(parseInt(apiConfig.rate_limit_window) || 60000);
      process.env.CORS_ORIGIN = apiConfig.cors_origin || '*';
      
      console.log('✅ API configuration loaded from Vault');
    } catch (error) {
      console.warn(`⚠️ Failed to load API config: ${error.message}`);
    }

    // Configuration spécifique au service de jeu
    if (serviceName === 'game-service') {
      try {
        const gameConfig = await vaultClient.getSecret('game');
        
        // Validation et assignation des configs de jeu
        const gameSettings = {
          WS_HEARTBEAT_INTERVAL: parseInt(gameConfig.ws_heartbeat_interval) || 30000,
          WS_CONNECTION_TIMEOUT: parseInt(gameConfig.ws_connection_timeout) || 60000,
          GAME_TICK_RATE: parseInt(gameConfig.game_tick_rate) || 60,
          MATCH_TIMEOUT: parseInt(gameConfig.match_timeout) || 600000,
          MATCHMAKING_TIMEOUT: parseInt(gameConfig.matchmaking_timeout) || 30000
        };

        for (const [key, value] of Object.entries(gameSettings)) {
          if (value > 0) {
            process.env[key] = String(value);
          }
        }

        console.log('✅ Game configuration loaded from Vault');
      } catch (error) {
        console.warn(`⚠️ Failed to load game config: ${error.message}`);
      }
    }

    // Configuration des ports par service
    const portMap = {
      'auth-service': '3000',
      'user-service': '3001',
      'game-service': '3002',
      'gateway-service': '3003'
    };

    if (portMap[serviceName]) {
      process.env.PORT = portMap[serviceName];
    }

    console.log(`✅ Environment variables loaded from Vault for ${serviceName}`);
    
  } catch (error) {
    console.error(`❌ Failed to load environment from Vault for ${serviceName}:`, error.message);
    console.warn('🔧 Using fallback configuration...');
    
    // Fallbacks critiques pour éviter les plantages
    if (!process.env.PORT) {
      const portMap = {
        'auth-service': '3000',
        'user-service': '3001', 
        'game-service': '3002',
        'gateway-service': '3003'
      };
      process.env.PORT = portMap[serviceName] || '3000';
    }
    
    // Ne pas faire throw ici pour permettre au service de démarrer avec des fallbacks
  }
}/**
 * Retourne le nom de la base de données pour un service
 * @param {string} serviceName - Nom du service
 * @returns {string} Nom de la base de données
 */
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
  loadEnvFromVault,
  SecretManager
};
