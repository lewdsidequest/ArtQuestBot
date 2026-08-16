/**
 * Base API Adapter Interface
 * All image source APIs must implement these methods.
 */

class BaseImageAPI {
  constructor(config) {
    this.config = config;
  }

  /**
   * Search for posts/artworks.
   * @param {Object} params - Search parameters
   * @param {string} params.tags - Base tags (e.g. "hatsune_miku")
   * @param {string[]} params.extraTags - Additional tags from rarity config
   * @param {string[]} params.filters - Global exclusion filters
   * @param {number} params.limit - Max results
   * @param {number} params.page - Page offset
   * @returns {Promise<Array>} Array of normalized artwork objects
   */
  async search(params) {
    throw new Error('search() must be implemented by subclass');
  }

  /**
   * Normalize a raw API response item into our standard format.
   * @param {Object} raw
   * @returns {Object}
   */
  normalize(raw) {
    throw new Error('normalize() must be implemented by subclass');
  }

  /**
   * Check if this adapter is available (auth configured, etc.)
   */
  isAvailable() {
    if (!this.config.requiresAuth) return true;
    return !!(this.config.apiKey || this.config.username);
  }

  /**
   * Build a safe URL that won't break embeds.
   */
  sanitizeUrl(url) {
    if (!url) return null;
    return url.replace(/^http:/, 'https:');
  }
}

module.exports = BaseImageAPI;
