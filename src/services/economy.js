const supabase = require("../database/supabase");

class EconomyService {
  /**
   * Register or get existing player.
   */
  async getOrCreatePlayer(discordId, globalDisplayName) {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("id", discordId)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new Error(`DB error: ${error.message}`);
    }

    if (data) {
      // 🛠️ ACTUALIZACIÓN DINÁMICA: Si el jugador cambió su Display Name Global en Discord,
      // lo actualizamos en la base de datos para que los Embeds siempre muestren el actual.
      if (data.username !== globalDisplayName && globalDisplayName) {
        // Lo actualizamos en segundo plano sin detener la ejecución de la función
        supabase
          .from("players")
          .update({ username: globalDisplayName })
          .eq("id", discordId)
          .then();
        data.username = globalDisplayName; // Actualizamos el objeto en memoria
      }
      return data;
    }

    // Leer configuración global desde la base de datos
    const { data: configData } = await supabase
      .from("global_configs")
      .select("value")
      .eq("key", "starting_stats")
      .single();

    // Valores por defecto como salvavidas si falla la BD
    const stats = configData?.value || {
      ink_dollars: 100,
      star_dust: 0,
      generator_limit: 3,
      inventory_limit: 50,
      collect_cooldown_hours: 1,
      max_offline_hours: 3,
    };

    // Create new player
    const { data: newPlayer, error: insertErr } = await supabase
      .from("players")
      .insert({
        id: discordId,
        username: globalDisplayName || "Unknown", // 🛠️ Usamos el Display Name aquí al crear la cuenta
        ink_dollars: stats.ink_dollars,
        star_dust: stats.star_dust,
        generator_limit: stats.generator_limit,
        inventory_limit: stats.inventory_limit,
        collect_cooldown_hours: stats.collect_cooldown_hours,
        max_offline_hours: stats.max_offline_hours,
        last_claim_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr)
      throw new Error(`Failed to register player: ${insertErr.message}`);
    return newPlayer;
  }

  /**
   * Get player by ID.
   */
  async getPlayer(discordId) {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .eq("id", discordId)
      .single();

    if (error) return null;
    return data;
  }

  /**
   * Get current ink generation rate per HOUR.
   */
  async getInkRate(discordId) {
    const { data, error } = await supabase.rpc("get_player_ink_rate", {
      p_player_id: discordId,
    });

    if (error) {
      console.error("[Economy] getInkRate error:", error.message);
      return 0;
    }
    return data || 0;
  }

  /**
   * Calculate how much a player can claim right now.
   */
  async calculateClaimAmount(discordId) {
    const player = await this.getPlayer(discordId);
    if (!player) return 0;

    // Leer maxOfflineHours directamente del jugador
    const maxHours = player.max_offline_hours || 3;

    const { data, error } = await supabase.rpc("calculate_offline_earnings", {
      p_player_id: discordId,
      p_max_hours: maxHours,
    });

    if (error) {
      console.error("[Economy] calculateClaimAmount error:", error.message);
      return 0;
    }
    return data || 0;
  }

  /**
   * Execute a claim (/collect).
   */
  async claim(discordId) {
    const player = await this.getPlayer(discordId);
    if (!player) throw new Error("Player not found");

    const lastClaim = new Date(player.last_claim_at);
    // Leer el cooldown específico del jugador
    const cooldownHours = player.collect_cooldown_hours || 2;
    const cooldownMs = cooldownHours * 60 * 60 * 1000;

    if (Date.now() - lastClaim.getTime() < cooldownMs) {
      const remainingMins = Math.ceil(
        (cooldownMs - (Date.now() - lastClaim.getTime())) / 60000,
      );
      throw new Error(`Cooldown: espera ${remainingMins} minutos más.`);
    }

    const amount = await this.calculateClaimAmount(discordId);
    if (amount <= 0) {
      throw new Error("No tienes ingresos pendientes. Revisa tu galería.");
    }

    const { error } = await supabase
      .from("players")
      .update({
        ink_dollars: player.ink_dollars + amount,
        total_claimed: player.total_claimed + amount,
        last_claim_at: new Date().toISOString(),
      })
      .eq("id", discordId);

    if (error) throw new Error(`Claim failed: ${error.message}`);

    return { amount, newBalance: player.ink_dollars + amount };
  }

  /**
   * Deduct currency from player.
   */
  async deductInk(discordId, amount) {
    const { data: player } = await supabase
      .from("players")
      .select("ink_dollars")
      .eq("id", discordId)
      .single();

    if (!player) {
      throw new Error("Jugador no encontrado al intentar cobrar.");
    }
    if (player.ink_dollars < amount) {
      throw new Error("Fondos insuficientes");
    }

    const { error } = await supabase
      .from("players")
      .update({ ink_dollars: player.ink_dollars - amount })
      .eq("id", discordId);

    if (error) throw new Error(`Deduct failed: ${error.message}`);
    return player.ink_dollars - amount;
  }

  /**
   * Add currency.
   */
  async addInk(discordId, amount) {
    const { data: player } = await supabase
      .from("players")
      .select("ink_dollars")
      .eq("id", discordId)
      .single();

    if (!player) throw new Error("Player not found");

    const { error: updErr } = await supabase
      .from("players")
      .update({ ink_dollars: player.ink_dollars + amount })
      .eq("id", discordId);

    if (updErr) throw new Error(`Add ink failed: ${updErr.message}`);
    return player.ink_dollars + amount;
  }

  /**
   * Add or deduct star dust.
   */
  async addStarDust(discordId, amount) {
    const { data: player } = await supabase
      .from("players")
      .select("star_dust")
      .eq("id", discordId)
      .single();

    if (!player) throw new Error("Player not found");

    const newAmount = Math.max(0, player.star_dust + amount);
    const { error } = await supabase
      .from("players")
      .update({ star_dust: newAmount })
      .eq("id", discordId);

    if (error) throw new Error(`Star dust update failed: ${error.message}`);
    return newAmount;
  }

  /**
   * Obtiene la lista detallada de las cartas que están generando dinero.
   */
  async getTopGeneratorsDetails(discordId) {
    const player = await this.getPlayer(discordId);
    if (!player) return [];

    // 🛠️ ACTUALIZACIÓN: Incluimos el rarity_id del player_artworks
    const { data: paData } = await supabase
      .from("player_artworks")
      .select(
        "id, rarity_id, level, stars, prestige_level, artworks!inner(name, rarity_id, collection_id)",
      )
      .eq("player_id", discordId)
      .eq("artworks.status", "active");

    if (!paData || paData.length === 0) return [];

    const { data: rcData } = await supabase
      .from("rarity_configs")
      .select("collection_id, rarity_id, base_ink_rate");

    const { data: configData } = await supabase
      .from("global_configs")
      .select("value")
      .eq("key", "game_modifiers")
      .maybeSingle();

    const modifiers = configData?.value || null;

    const rcMap = {};
    for (const rc of rcData || []) {
      rcMap[`${rc.collection_id}_${rc.rarity_id}`] = rc.base_ink_rate;
    }

    const { calculateInkRate } = require("../utils/power");

    const enriched = paData.map((pa) => {
      // 🛠️ ECONOMÍA: Identificamos si la carta fue evolucionada para su tarifa
      const activeRarityId = pa.rarity_id || pa.artworks.rarity_id;

      const baseRate =
        rcMap[`${pa.artworks.collection_id}_${activeRarityId}`] || 0;

      const rate = calculateInkRate(
        baseRate,
        pa.stars,
        pa.level,
        pa.prestige_level || 0,
        modifiers,
      );
      return { ...pa, rate };
    });

    enriched.sort((a, b) => b.rate - a.rate);
    return enriched.slice(0, player.generator_limit);
  }

  /**
   * 🛠️ NUEVO: Suma el dinero gastado en el casino (Slots o Gacha)
   */
  async addCasinoSpent(discordId, amount) {
    const { data: player } = await supabase
      .from("players")
      .select("casino_spent")
      .eq("id", discordId)
      .single();

    if (!player) return;

    await supabase
      .from("players")
      .update({ casino_spent: (player.casino_spent || 0) + amount })
      .eq("id", discordId);
  }
}

module.exports = new EconomyService();
