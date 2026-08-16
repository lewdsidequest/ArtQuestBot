/**
 * Game Configuration
 * ALL game constants live here. Nothing is hardcoded in business logic.
 */

require("dotenv").config();

const GAME = {
  // ─── Economy ───
  economy: {
    startingInkDollars: 200,
    startingStarDust: 0,
    startingGeneratorLimit: 3,
    startingInventoryLimit: 100,
    claimCooldownHours: parseInt(process.env.CLAIM_COOLDOWN_HOURS || "2", 10),
    maxOfflineClaimHours: parseInt(
      process.env.MAX_OFFLINE_CLAIM_HOURS || "3",
      10,
    ),
    starUpgradeCost: [0, 5, 20, 40, 40, 80, 160, 320, 640, 1280],
    levelUpgrade: {
      base: 100,
      exponent: 1.5,
      inkMultiplier: 1.0,
    },
  },

  // ─── Cache ───
  cache: {
    target: parseInt(process.env.CACHE_TARGET || "100", 10),
    refreshThreshold: parseInt(process.env.CACHE_REFRESH_THRESHOLD || "20", 10),
    batchSize: parseInt(process.env.CACHE_BATCH_SIZE || "25", 10),
    maxAgeHours: 48,
  },

  // ─── Rarities (Simplified) ───
  rarities: {
    stars: {
      max: 10,
      multiplierPerStar: 0.2,
    },
    levels: {
      max: 100,
      multiplierPerLevel: 0.1,
    },
  },

  // ─── APIs ───
  apis: {
    safebooru: {
      name: "Safebooru",
      baseUrl: "https://safebooru.org/index.php",
      pageParam: "pid",
      tagsParam: "tags",
      requiresAuth: false,
      defaultLimit: 100,
      requestDelayMs: 500,
    },
    e621: {
      name: "E621",
      baseUrl: "https://e621.net",
      requiresAuth: true,
      apiKey: process.env.E621_API_KEY || "",
      userLogin: process.env.E621_USER_LOGIN || "",
      defaultLimit: 100,
      requestDelayMs: 1000,
    },
    rule34: {
      name: "Rule34",
      baseUrl: "https://api.rule34.xxx/index.php",
      requiresAuth: true,
      apiKey: process.env.RULE34_API_KEY || "",
      userId: process.env.RULE34_USER_ID || "",
      defaultLimit: 100,
      requestDelayMs: 500,
    },
  },

  // ─── Discord ───
  discord: {
    embedMaxDescriptionLength: 4096,
    embedMaxFieldLength: 1024,
    messageComponentsTimeout: 60000,
  },
};

module.exports = GAME;
