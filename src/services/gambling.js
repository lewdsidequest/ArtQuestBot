const supabase = require("../database/supabase");
const economy = require("./economy");

class GamblingService {
  async checkJackpotLimit(playerId, machine) {
    let maxJackpots = machine.config?.limit_max;
    let cooldownDays = machine.config?.limit_cooldown_days;

    if (maxJackpots === undefined || cooldownDays === undefined) {
      const { data: configData } = await supabase
        .from("global_configs")
        .select("value")
        .eq("key", "jackpot_limits")
        .maybeSingle();
      const globalConfig = configData?.value || {
        max_jackpots: 3,
        cooldown_days: 1,
      };
      maxJackpots = maxJackpots ?? globalConfig.max_jackpots;
      cooldownDays = cooldownDays ?? globalConfig.cooldown_days;
    }

    const { data: record } = await supabase
      .from("player_jackpots")
      .select("*")
      .eq("player_id", playerId)
      .eq("machine_id", machine.id)
      .maybeSingle();

    if (record) {
      const resetAt = new Date(record.reset_at);
      const now = new Date();

      if (now < resetAt && record.jackpots_won >= maxJackpots) {
        const diffMs = resetAt.getTime() - now.getTime();
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor(
          (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
        );
        const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        let timeStr = "";
        if (days > 0) timeStr += `${days}d `;
        if (hours > 0) timeStr += `${hours}h `;
        timeStr += `${mins}m`;

        throw new Error(
          `🚫 **Mensaje del casino:** Has agotado tus recompensas máximas para esta máquina.\nUsa una maquina diferente o vuelve en **${timeStr.trim()}** para jugar de nuevo.`,
        );
      }
    }
    return { max_jackpots: maxJackpots, cooldown_days: cooldownDays };
  }

  async recordSpin(playerId, machineId, isJackpot, appliedConfig) {
    const { data: record } = await supabase
      .from("player_jackpots")
      .select("*")
      .eq("player_id", playerId)
      .eq("machine_id", machineId)
      .maybeSingle();

    const now = new Date();
    let newWon = record ? record.jackpots_won : 0;
    let newSpins = record ? (record.spins_since_jackpot || 0) + 1 : 1;
    let newReset = record
      ? record.reset_at
      : new Date(
          now.getTime() +
            (appliedConfig.cooldown_days || 1) * 24 * 60 * 60 * 1000,
        ).toISOString();

    if (record && now >= new Date(record.reset_at)) {
      newWon = 0;
      newReset = new Date(
        now.getTime() +
          (appliedConfig.cooldown_days || 1) * 24 * 60 * 60 * 1000,
      ).toISOString();
    }

    if (isJackpot) {
      newWon += 1;
      newSpins = 0;
    }

    await supabase.from("player_jackpots").upsert({
      player_id: playerId,
      machine_id: machineId,
      jackpots_won: newWon,
      reset_at: newReset,
      spins_since_jackpot: newSpins,
    });

    return newSpins;
  }

  async getActiveMachines(typeFilter = null) {
    let query = supabase
      .from("gambling_machines")
      .select("*")
      .eq("enabled", true)
      .order("id");

    if (typeFilter === "slots") {
      query = query.in("machine_type", ["ink_slots", "dust_slots"]);
    } else if (typeFilter === "gacha") {
      query = query.eq("machine_type", "gacha");
    }

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron cargar las máquinas.");
    let machines = data || [];

    // 🛠️ LÓGICA DE ROTACIÓN A PRUEBA DE BALAS
    if (typeFilter === "gacha" || !typeFilter) {
      try {
        const { data: rotConfigData } = await supabase
          .from("global_configs")
          .select("value")
          .eq("key", "gacha_rotation")
          .maybeSingle();

        const rotConfig = rotConfigData?.value;

        if (
          rotConfig &&
          Array.isArray(rotConfig.pool) &&
          rotConfig.pool.length > 0
        ) {
          // 1. Forzamos todos los IDs del pool a números para evitar conflictos con strings
          const pool = rotConfig.pool.map(Number);
          const activeCount = Math.max(1, Number(rotConfig.active_count) || 1);
          const rotationDays = Math.max(
            1,
            Number(rotConfig.rotation_days) || 7,
          );

          // 2. Manejo seguro de fechas (Fallback si el epoch es inválido)
          let epochStart = new Date(
            rotConfig.epoch_start || "2026-08-01T00:00:00Z",
          ).getTime();
          if (isNaN(epochStart))
            epochStart = new Date("2026-08-01T00:00:00Z").getTime();

          const now = Date.now();
          const daysSinceEpoch = Math.floor(
            (now - epochStart) / (1000 * 60 * 60 * 24),
          );
          const rotationIndex = Math.floor(daysSinceEpoch / rotationDays);

          const activeIds = [];
          for (let i = 0; i < activeCount; i++) {
            // 3. Modulo Matemático Seguro (Evita que el índice se rompa si la fecha está en el futuro)
            const safeIndex =
              (((rotationIndex + i) % pool.length) + pool.length) % pool.length;
            activeIds.push(pool[safeIndex]);
          }

          const uniqueActiveIds = [...new Set(activeIds)];

          // 4. Forzamos m.id a Número para la comparación estricta
          machines = machines.filter(
            (m) =>
              m.machine_type !== "gacha" ||
              uniqueActiveIds.includes(Number(m.id)),
          );
        }
      } catch (err) {
        console.error(
          "[Gambling] Error en rotación Gacha (Mostrando fallback):",
          err.message,
        );
        // Si la matemática falla, el try...catch evitará que devuelva un array vacío.
        // Simplemente devolverá todas las máquinas gacha disponibles como salvavidas.
      }
    }

    return machines;
  }

  async playSlots(playerId, machine, betAmount) {
    const jpConfig = await this.checkJackpotLimit(playerId, machine);

    if (betAmount > machine.max_bet) {
      throw new Error(
        `La apuesta máxima permitida en esta máquina es de **${machine.max_bet}**.`,
      );
    }

    const isDust = machine.machine_type === "dust_slots";

    if (isDust) {
      const player = await economy.getPlayer(playerId);
      if (player.star_dust < betAmount)
        throw new Error("No tienes suficiente Polvo de Estrella.");
      await economy.addStarDust(playerId, -betAmount);
    } else {
      await economy.deductInk(playerId, betAmount);
    }

    const roll = Math.random();
    let cumulative = 0;
    let selectedPayout = null;
    let isJackpot = false;

    const payouts = machine.config.payouts || [];
    for (let i = 0; i < payouts.length; i++) {
      cumulative += payouts[i].chance;
      if (roll <= cumulative) {
        selectedPayout = payouts[i];
        if (i === payouts.length - 1 && payouts[i].mult >= 5) isJackpot = true;
        break;
      }
    }

    if (!selectedPayout) selectedPayout = payouts[0];
    const winnings = Math.floor(betAmount * selectedPayout.mult);

    if (winnings > 0) {
      if (isDust) await economy.addStarDust(playerId, winnings);
      else await economy.addInk(playerId, winnings);
    }

    const currentPity = await this.recordSpin(
      playerId,
      machine.id,
      isJackpot,
      jpConfig,
    );
    await economy.addCasinoSpent(playerId, betAmount);

    return {
      betAmount,
      winnings,
      multiplier: selectedPayout.mult,
      isJackpot,
      currency: isDust ? "Polvo" : "Ink$",
      pityCount: currentPity,
    };
  }

  async playGacha(playerId, machine) {
    const jpConfig = await this.checkJackpotLimit(playerId, machine);

    const cost = machine.max_bet;
    await economy.deductInk(playerId, cost);

    const roll = Math.random();
    let cumulative = 0;
    let selectedPayout = null;
    let isJackpot = false;

    const payouts = machine.config.payouts || [];
    for (let i = 0; i < payouts.length; i++) {
      cumulative += payouts[i].chance;
      if (roll <= cumulative) {
        selectedPayout = payouts[i];
        if (i === payouts.length - 1) isJackpot = true;
        break;
      }
    }

    if (!selectedPayout) selectedPayout = payouts[0];
    const inkWinnings = Math.floor(cost * selectedPayout.mult);
    if (inkWinnings > 0) await economy.addInk(playerId, inkWinnings);

    let cardWon = null;
    let isDuplicate = false;
    let cardWonPaId = null;

    if (isJackpot && machine.promo_collection_id) {
      const { data: promoCol } = await supabase
        .from("collections")
        .select("tier")
        .eq("id", machine.promo_collection_id)
        .single();
      const initialPrestige = promoCol?.tier || 0;
      const { data: promoCards } = await supabase
        .from("artworks")
        .select("*")
        .eq("collection_id", machine.promo_collection_id)
        .eq("status", "active");

      if (promoCards && promoCards.length > 0) {
        const { data: ownedCardsData } = await supabase
          .from("player_artworks")
          .select("artwork_id")
          .eq("player_id", playerId)
          .in(
            "artwork_id",
            promoCards.map((c) => c.id),
          );
        const ownedIds = ownedCardsData.map((c) => c.artwork_id);
        const unownedCards = promoCards.filter((c) => !ownedIds.includes(c.id));

        let selectedCard;
        if (
          unownedCards.length > 0 &&
          ownedIds.length > 0 &&
          unownedCards.length < promoCards.length
        ) {
          const coinFlip = Math.random() < 0.5;
          if (coinFlip)
            selectedCard =
              unownedCards[Math.floor(Math.random() * unownedCards.length)];
          else
            selectedCard =
              promoCards[Math.floor(Math.random() * promoCards.length)];
        } else if (unownedCards.length > 0) {
          selectedCard =
            unownedCards[Math.floor(Math.random() * unownedCards.length)];
        } else {
          selectedCard =
            promoCards[Math.floor(Math.random() * promoCards.length)];
        }

        isDuplicate = ownedIds.includes(selectedCard.id);
        cardWon = selectedCard;

        const { data: insertedCard, error: insertErr } = await supabase
          .from("player_artworks")
          .insert({
            player_id: playerId,
            artwork_id: selectedCard.id,
            stars: 1,
            level: 1,
            prestige_level: initialPrestige,
            invested_ink: 0,
            invested_dust: 0,
            rarity_id: selectedCard.rarity_id,
          })
          .select("id")
          .single();

        if (insertErr)
          throw new Error("Error al guardar la carta en el inventario.");
        cardWonPaId = insertedCard.id;

        if (!isDuplicate && !selectedCard.discovered_by)
          await supabase
            .from("artworks")
            .update({ discovered_by: playerId })
            .eq("id", selectedCard.id);
        if (!isDuplicate)
          await supabase
            .from("player_discoveries")
            .insert({ player_id: playerId, artwork_id: selectedCard.id });
      }
    }

    const currentPity = await this.recordSpin(
      playerId,
      machine.id,
      isJackpot,
      jpConfig,
    );
    await economy.addCasinoSpent(playerId, cost);

    return {
      cost,
      inkWinnings,
      isJackpot,
      cardWon,
      isDuplicate,
      cardWonPaId,
      pityCount: currentPity,
    };
  }
}

module.exports = new GamblingService();
