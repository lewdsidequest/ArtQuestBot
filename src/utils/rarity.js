const supabase = require("../database/supabase");

class RarityManager {
  constructor() {
    this.rarities = new Map();
    this.isLoaded = false;
  }

  /**
   * Carga la tabla de rarezas en memoria
   */
  async loadRarities() {
    const { data, error } = await supabase.from("rarities").select("*");
    if (error) throw new Error("Fallo al cargar rarezas de la BD.");

    this.rarities.clear();
    for (const r of data) {
      this.rarities.set(r.id, r);
    }
    this.isLoaded = true;
    console.log(`[RarityManager] Cargadas ${this.rarities.size} rarezas.`);
  }

  /**
   * Obtiene una rareza por su ID
   */
  get(rarityId) {
    if (!this.isLoaded) console.warn("RarityManager no ha sido inicializado!");
    return this.rarities.get(rarityId) || null;
  }

  /**
   * Roll a rarity based on configured probabilities for a collection.
   * @param {Array} configs - Array of rarity_configs rows for a collection
   * @returns {number} Rolled rarity_id
   */
  rollRarity(configs) {
    const rand = Math.random();
    let cumulative = 0;

    const sorted = [...configs].sort((a, b) => a.probability - b.probability);

    for (const cfg of sorted) {
      cumulative += parseFloat(cfg.probability);
      if (rand < cumulative) {
        return cfg.rarity_id;
      }
    }

    return sorted[0]?.rarity_id || 1; // Default to ID 1 si falla
  }

  formatStars(count) {
    const c = Math.max(1, Math.min(10, count));
    return "★".repeat(c);
  }
}

// Exportamos una instancia única (Singleton)
module.exports = new RarityManager();
