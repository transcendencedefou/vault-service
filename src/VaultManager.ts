import vault from 'node-vault';
import crypto from 'crypto';

export class VaultManager {
  private vault: any;
  private isInitialized = false;

  constructor() {
    this.vault = vault({
      apiVersion: 'v1',
      endpoint: process.env.VAULT_ADDR || 'http://vault:8200',
      token: process.env.VAULT_TOKEN || this.getSecureRootToken()
    });
  }

  /**
   * Récupère ou génère un token root sécurisé
   * En production, ceci devrait être fourni via des variables d'environnement sécurisées
   */
  private getSecureRootToken(): string {
    // En développement, utilise un token fixe
    if (process.env.NODE_ENV === 'development') {
      return 'vault-root-token';
    }

    // En production, le token DOIT être fourni via VAULT_TOKEN
    if (!process.env.VAULT_TOKEN) {
      throw new Error('VAULT_TOKEN must be provided in production environment');
    }

    return process.env.VAULT_TOKEN;
  }

  async initialize() {
    try {
      console.log('🔐 Initializing Vault...');

      // Attendre que Vault soit prêt
      await this.waitForVault();

      // Initialize vault policies
      await this.setupPolicies();

      // Store initial secrets
      await this.storeInitialSecrets();

      this.isInitialized = true;
      console.log('✅ Vault initialized successfully');
    } catch (error) {
      console.error('❌ Vault initialization failed:', error);
      throw error;
    }
  }

  private async waitForVault(maxRetries = 30) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.vault.health();
        console.log('✅ Vault is ready');
        return;
      } catch (error) {
        console.log(`⏳ Waiting for Vault... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    throw new Error('Vault is not available after maximum retries');
  }

  private async setupPolicies() {
    const policies = {
      'transcendence-admin': `
        path "secret/data/transcendence/*" {
          capabilities = ["create", "read", "update", "delete", "list"]
        }
        path "secret/metadata/transcendence/*" {
          capabilities = ["list", "delete"]
        }
        path "auth/token/*" {
          capabilities = ["create", "read", "update", "delete", "list"]
        }
      `,
      'transcendence-service': `
        path "secret/data/transcendence/database" {
          capabilities = ["read"]
        }
        path "secret/data/transcendence/jwt" {
          capabilities = ["read"]
        }
        path "secret/data/transcendence/encryption" {
          capabilities = ["read"]
        }
        path "secret/data/transcendence/oauth" {
          capabilities = ["read"]
        }
        path "secret/data/transcendence/api" {
          capabilities = ["read"]
        }
        path "auth/token/lookup-self" {
          capabilities = ["read"]
        }
      `,
      'transcendence-auth': `
        path "secret/data/transcendence/database" {
          capabilities = ["read"]
        }
        path "secret/data/transcendence/jwt" {
          capabilities = ["read", "update"]
        }
        path "secret/data/transcendence/oauth" {
          capabilities = ["read"]
        }
      `,
      'transcendence-db': `
        path "secret/data/transcendence/database" {
          capabilities = ["read"]
        }
      `
    };

    for (const [name, policy] of Object.entries(policies)) {
      try {
        await this.vault.addPolicy({ name, rules: policy });
        console.log(`📋 Policy '${name}' created`);
      } catch (error) {
        console.log(`📋 Policy '${name}' already exists or error:`, (error as Error).message);
      }
    }
  }

  private async storeInitialSecrets() {
    const secrets = {
      'secret/data/transcendence/database': {
        data: {
          host: 'database-service',
          port: '3306',
          username: 'user',
          password: this.generateSecurePassword(24),
          root_password: this.generateSecurePassword(32),
          main_database: 'transcendence',
          // NOUVELLE CONFIG : Une seule base pour tous les services
          shared_database: 'transcendence',
          url_template: 'mysql://{username}:{password}@{host}:{port}/{database}'
        }
      },
      'secret/data/transcendence/jwt': {
        data: {
          secret: this.generateSecureKey(64),
          algorithm: 'HS256',
          expiration: '24h',
          refresh_expiration: '7d',
          issuer: 'transcendence',
          audience: 'transcendence-users',
          created_at: new Date().toISOString()
        }
      },
      'secret/data/transcendence/encryption': {
        data: {
          key: this.generateSecureKey(32),
          algorithm: 'aes-256-gcm',
          iv_length: '16',
          created_at: new Date().toISOString()
        }
      },
      'secret/data/transcendence/oauth': {
        data: {
          google_client_id: process.env.GOOGLE_CLIENT_ID || 'your-google-client-id',
          google_client_secret: process.env.GOOGLE_CLIENT_SECRET || this.generateSecureKey(32),
          github_client_id: process.env.GITHUB_CLIENT_ID || 'Ov23liYOrKaDhnkpgwvT',
          github_client_secret: process.env.GITHUB_CLIENT_SECRET || 'e2761b04180f7b5b2f1199e9dc97d699e8074588',
          github_redirect_uri: process.env.GITHUB_REDIRECT_URI || 'https://localhost/oauth/github/callback',
          // Variables 42 Intra OAuth
          intra_client_id: process.env.INTRA_CLIENT_ID || 'u-s4t2ud-2e713f8650a64fa14b4653d833834963aaa8d2191f94adf2ed6090215b3b846b',
          intra_client_secret: process.env.INTRA_CLIENT_SECRET || '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',
          intra_redirect_uri: process.env.INTRA_REDIRECT_URI || 'https://localhost/oauth/42/callback',
          callback_url_base: process.env.CALLBACK_URL_BASE || 'https://localhost/auth/callback',
          created_at: new Date().toISOString()
        }
      },
      'secret/data/transcendence/api': {
        data: {
          rate_limit_max: process.env.RATE_LIMIT_MAX || '100',
          rate_limit_window: process.env.RATE_LIMIT_WINDOW || '60000',
          cors_origin: process.env.CORS_ORIGIN || 'http://localhost:3000,https://localhost',
          session_secret: this.generateSecureKey(32),
          api_version: '1.0.0',
          created_at: new Date().toISOString()
        }
      },
      'secret/data/transcendence/services': {
        data: {
          auth_service_url: 'http://auth-service:3000',
          user_service_url: 'http://user-service:3001',
          game_service_url: 'http://game-service:3002',
          gateway_service_url: 'http://gateway-service:3003',
          vault_service_url: 'http://vault-service:8300',
          // Configuration des ports pour chaque service
          auth_service_port: '3000',
          user_service_port: '3001',
          game_service_port: '3002',
          gateway_service_port: '3003',
          vault_service_port: '8300'
        }
      },
      'secret/data/transcendence/game': {
        data: {
          ws_heartbeat_interval: '30000',
          ws_connection_timeout: '60000',
          game_tick_rate: '60',
          match_timeout: '600000',
          matchmaking_timeout: '30000',
          max_players_per_game: '4',
          // Variables de sécurité pour HSTS
          force_https: 'true',
          hsts_max_age: '31536000',
          security_headers: 'true'
        }
      }
    };

    for (const [path, secret] of Object.entries(secrets)) {
      try {
        // Vérifier si le secret existe déjà
        try {
          await this.vault.read(path);
          console.log(`🔒 Secret already exists at ${path}`);
        } catch (readError) {
          // Le secret n'existe pas, on le crée
          await this.vault.write(path, secret);
          console.log(`🔒 Secret stored at ${path}`);
        }
      } catch (error) {
        console.log(`🔒 Error handling secret at ${path}:`, (error as Error).message);
      }
    }
  }

  async getSecret(path: string): Promise<any> {
    try {
      const result = await this.vault.read(`secret/data/transcendence/${path}`);
      return result.data.data;
    } catch (error) {
      console.error(`❌ Error reading secret from ${path}:`, error);
      throw error;
    }
  }

  async updateSecret(path: string, data: any): Promise<void> {
    try {
      await this.vault.write(`secret/data/transcendence/${path}`, { data });
      console.log(`✅ Secret updated at transcendence/${path}`);
    } catch (error) {
      console.error(`❌ Error updating secret at ${path}:`, error);
      throw error;
    }
  }

  async getDatabaseConfig(): Promise<any> {
    const dbSecrets = await this.getSecret('database');
    return {
      host: dbSecrets.host,
      port: parseInt(dbSecrets.port),
      username: dbSecrets.username,
      password: dbSecrets.password,
      // NOUVELLE CONFIG : Base unique
      database: dbSecrets.shared_database || 'transcendence',
      getDatabaseUrl: () => {
        const database = dbSecrets.shared_database || 'transcendence';
        return `mysql://${dbSecrets.username}:${dbSecrets.password}@${dbSecrets.host}:${dbSecrets.port}/${database}`;
      }
    };
  }

  async getServiceUrls(): Promise<any> {
    return await this.getSecret('services');
  }

  async rotateJWTSecret(): Promise<string> {
    const currentJwt = await this.getSecret('jwt');
    const newSecret = this.generateSecureKey(64);

    await this.updateSecret('jwt', {
      ...currentJwt,
      secret: newSecret,
      rotated_at: new Date().toISOString(),
      previous_secret: currentJwt.secret // Garder l'ancien pour la transition
    });

    return newSecret;
  }

  async createServiceToken(serviceName: string, policies: string[]): Promise<string> {
    try {
      const tokenData = await this.vault.tokenCreate({
        policies: policies,
        ttl: '24h',
        renewable: true,
        meta: {
          service: serviceName,
          created_at: new Date().toISOString()
        }
      });

      console.log(`🎫 Service token created for ${serviceName}`);
      return tokenData.auth.client_token;
    } catch (error) {
      console.error(`❌ Error creating service token for ${serviceName}:`, error);
      throw error;
    }
  }

  async getHealthStatus(): Promise<any> {
    try {
      const health = await this.vault.health();
      return {
        vault_status: 'healthy',
        initialized: health.initialized,
        sealed: health.sealed,
        standby: health.standby,
        version: health.version
      };
    } catch (error) {
      return {
        vault_status: 'unhealthy',
        error: (error as Error).message
      };
    }
  }

  private generateSecureKey(length: number): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Génère un mot de passe sécurisé avec caractères spéciaux
   * @param length Longueur du mot de passe
   * @returns Mot de passe sécurisé
   */
  private generateSecurePassword(length: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';

    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      password += charset[randomIndex];
    }

    return password;
  }

  isReady(): boolean {
    return this.isInitialized;
  }
}

export default VaultManager;
