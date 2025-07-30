import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { VaultManager } from './VaultManager';

const app = express();
const PORT = process.env.PORT || 8300;

// Middlewares
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

// Initialize Vault
const vaultManager = new VaultManager();

// Routes
app.get('/health', async (req, res) => {
  try {
    const health = await vaultManager.getHealthStatus();
    res.json({
      service: 'vault-service',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      vault: health
    });
  } catch (error) {
    res.status(500).json({
      service: 'vault-service',
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get secrets endpoint for services
app.get('/api/secrets/:path', async (req, res) => {
  try {
    const { path } = req.params;
    const secrets = await vaultManager.getSecret(path);
    res.json({ success: true, data: secrets });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: error instanceof Error ? error.message : 'Secret not found'
    });
  }
});

// Get database configuration
app.get('/api/database/config', async (req, res) => {
  try {
    const config = await vaultManager.getDatabaseConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Database config error'
    });
  }
});

// Get service URLs
app.get('/api/services/urls', async (req, res) => {
  try {
    const urls = await vaultManager.getServiceUrls();
    res.json({ success: true, data: urls });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Service URLs error'
    });
  }
});

// Create service token
app.post('/api/tokens/service', async (req, res) => {
  try {
    const { serviceName, policies } = req.body;
    if (!serviceName || !policies) {
      return res.status(400).json({
        success: false,
        error: 'serviceName and policies are required'
      });
    }

    const token = await vaultManager.createServiceToken(serviceName, policies);
    res.json({ success: true, data: { token } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Token creation error'
    });
  }
});

// Rotate JWT secret
app.post('/api/jwt/rotate', async (req, res) => {
  try {
    const newSecret = await vaultManager.rotateJWTSecret();
    res.json({ success: true, message: 'JWT secret rotated successfully' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'JWT rotation error'
    });
  }
});

// Update secret
app.put('/api/secrets/:path', async (req, res) => {
  try {
    const { path } = req.params;
    const { data } = req.body;

    if (!data) {
      return res.status(400).json({
        success: false,
        error: 'data is required'
      });
    }

    await vaultManager.updateSecret(path, data);
    res.json({ success: true, message: 'Secret updated successfully' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Secret update error'
    });
  }
});

// Initialize and start server
async function startServer() {
  try {
    console.log('🚀 Starting Vault Service...');

    // Initialize Vault
    await vaultManager.initialize();

    app.listen(PORT, () => {
      console.log(`✅ Vault Service running on port ${PORT}`);
      console.log(`🔗 Health endpoint: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start Vault Service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});

startServer();
