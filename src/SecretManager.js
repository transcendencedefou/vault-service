const crypto = require('crypto');

/**
 * Générateur de secrets sécurisés et utilitaires de sécurité
 */
class SecretManager {
  /**
   * Génère un token sécurisé
   * @param {number} length - Longueur en bytes
   * @returns {string} Token hexadécimal
   */
  static generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Génère un UUID v4
   * @returns {string} UUID
   */
  static generateUUID() {
    return crypto.randomUUID();
  }

  /**
   * Génère un mot de passe sécurisé
   * @param {number} length - Longueur du mot de passe
   * @returns {string} Mot de passe
   */
  static generateSecurePassword(length = 16) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    
    for (let i = 0; i < length; i++) {
      const randomIndex = crypto.randomInt(0, charset.length);
      password += charset[randomIndex];
    }
    
    return password;
  }

  /**
   * Hash une chaîne avec salt
   * @param {string} data - Données à hasher
   * @param {string} salt - Salt (optionnel)
   * @returns {Object} Hash et salt
   */
  static hashWithSalt(data, salt = null) {
    if (!salt) {
      salt = crypto.randomBytes(16).toString('hex');
    }
    
    const hash = crypto.pbkdf2Sync(data, salt, 10000, 64, 'sha512').toString('hex');
    
    return { hash, salt };
  }

  /**
   * Vérifie un hash avec salt
   * @param {string} data - Données à vérifier
   * @param {string} hash - Hash à comparer
   * @param {string} salt - Salt utilisé
   * @returns {boolean} Vrai si correspond
   */
  static verifyHash(data, hash, salt) {
    const { hash: computedHash } = this.hashWithSalt(data, salt);
    return computedHash === hash;
  }

  /**
   * Masque un secret pour les logs
   * @param {string} secret - Secret à masquer
   * @param {number} visibleChars - Nombre de caractères visibles
   * @returns {string} Secret masqué
   */
  static maskSecret(secret, visibleChars = 4) {
    if (!secret || secret.length <= visibleChars) {
      return '***';
    }
    
    const visible = secret.substring(0, visibleChars);
    const masked = '*'.repeat(Math.min(secret.length - visibleChars, 8));
    
    return `${visible}${masked}`;
  }

  /**
   * Valide la force d'un mot de passe
   * @param {string} password - Mot de passe à valider
   * @returns {Object} Résultat de validation
   */
  static validatePasswordStrength(password) {
    const result = {
      valid: false,
      score: 0,
      requirements: {
        minLength: false,
        hasUppercase: false,
        hasLowercase: false,
        hasNumbers: false,
        hasSpecialChars: false
      }
    };

    if (!password) return result;

    // Vérifications
    result.requirements.minLength = password.length >= 12;
    result.requirements.hasUppercase = /[A-Z]/.test(password);
    result.requirements.hasLowercase = /[a-z]/.test(password);
    result.requirements.hasNumbers = /\d/.test(password);
    result.requirements.hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

    // Calcul du score
    result.score = Object.values(result.requirements).filter(Boolean).length;
    result.valid = result.score >= 4 && result.requirements.minLength;

    return result;
  }
}

module.exports = SecretManager;
