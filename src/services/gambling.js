const supabase = require("../database/supabase");
const economy = require("./economy");

class GamblingService {
  /**
   * Obtiene la lista de máquinas activas filtradas por tipo.
   */
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
    return data || [];
  }

  /**
   * Juega en una máquina tipo Slots (Ink$ o Dust)
   */
  async playSlots(playerId, machine, betAmount) {
    if (betAmount > machine.max_bet) {
      throw new Error(
        `La apuesta máxima permitida en esta máquina es de **${machine.max_bet}**.`,
      );
    }

    const isDust = machine.machine_type === "dust_slots";

    // 1. Cobrar apuesta
    if (isDust) {
      const player = await economy.getPlayer(playerId);
      if (player.star_dust < betAmount)
        throw new Error("No tienes suficiente Polvo de Estrella.");
      await economy.addStarDust(playerId, -betAmount);
    } else {
      await economy.deductInk(playerId, betAmount);
    }

    // 2. Tirada RNG y selección de premio
    const roll = Math.random();
    let cumulative = 0;
    let selectedPayout = null;
    let isJackpot = false;

    // Asumimos que los payouts vienen ordenados en el config (de mayor chance a menor chance)
    const payouts = machine.config.payouts || [];
    for (let i = 0; i < payouts.length; i++) {
      cumulative += payouts[i].chance;
      if (roll <= cumulative) {
        selectedPayout = payouts[i];
        // Consideramos "Jackpot" si es el premio con el multiplicador más alto (usualmente el último de la lista)
        if (i === payouts.length - 1 && payouts[i].mult >= 5) isJackpot = true;
        break;
      }
    }

    // Salvavidas si algo falla en la config
    if (!selectedPayout) selectedPayout = payouts[0];

    const winnings = Math.floor(betAmount * selectedPayout.mult);

    // 3. Pagar ganancias
    if (winnings > 0) {
      if (isDust) {
        await economy.addStarDust(playerId, winnings);
      } else {
        await economy.addInk(playerId, winnings);
      }
    }

    return {
      betAmount,
      winnings,
      multiplier: selectedPayout.mult,
      isJackpot,
      currency: isDust ? "Polvo" : "Ink$",
    };
  }

  /**
   * Juega en una máquina tipo Gacha
   */
  async playGacha(playerId, machine) {
    const cost = machine.max_bet; // En el gacha, max_bet funciona como el costo fijo del pull
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
        if (i === payouts.length - 1) isJackpot = true; // El premio mayor es la carta promo
        break;
      }
    }

    if (!selectedPayout) selectedPayout = payouts[0];

    const inkWinnings = Math.floor(cost * selectedPayout.mult);
    if (inkWinnings > 0) {
      await economy.addInk(playerId, inkWinnings);
    }

    let cardWon = null;
    let isDuplicate = false;
    let cardWonPaId = null;

    // LÓGICA GACHA (Carta Promo)
    if (isJackpot && machine.promo_collection_id) {
      // 🛠️ NUEVO: Obtener el tier de la colección para el prestigio inicial
      const { data: promoCol } = await supabase
        .from("collections")
        .select("tier")
        .eq("id", machine.promo_collection_id)
        .single();

      const initialPrestige = promoCol?.tier || 0;

      // 1. Obtener todas las cartas disponibles en la colección promo
      const { data: promoCards } = await supabase
        .from("artworks")
        .select("*")
        .eq("collection_id", machine.promo_collection_id)
        .eq("status", "active");

      if (promoCards && promoCards.length > 0) {
        // 2. Obtener las cartas que el jugador ya tiene de esta colección
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

        // 3. Tirada de moneda (Pity/50-50)
        let selectedCard;
        if (
          unownedCards.length > 0 &&
          ownedIds.length > 0 &&
          unownedCards.length < promoCards.length
        ) {
          const coinFlip = Math.random() < 0.5;
          if (coinFlip) {
            selectedCard =
              unownedCards[Math.floor(Math.random() * unownedCards.length)];
          } else {
            selectedCard =
              promoCards[Math.floor(Math.random() * promoCards.length)];
          }
        } else if (unownedCards.length > 0) {
          selectedCard =
            unownedCards[Math.floor(Math.random() * unownedCards.length)];
        } else {
          selectedCard =
            promoCards[Math.floor(Math.random() * promoCards.length)];
        }

        isDuplicate = ownedIds.includes(selectedCard.id);
        cardWon = selectedCard;

        // 4. Entregar la carta obteniendo el ID del inventario
        const { data: insertedCard, error: insertErr } = await supabase
          .from("player_artworks")
          .insert({
            player_id: playerId,
            artwork_id: selectedCard.id,
            stars: 1,
            level: 1,
            prestige_level: initialPrestige, // 🛠️ CORREGIDO
            invested_ink: 0,
            invested_dust: 0,
          })
          .select("id")
          .single();

        if (insertErr)
          throw new Error("Error al guardar la carta en el inventario.");

        cardWonPaId = insertedCard.id;

        if (!isDuplicate && !selectedCard.discovered_by) {
          await supabase
            .from("artworks")
            .update({ discovered_by: playerId })
            .eq("id", selectedCard.id);
        }
        if (!isDuplicate) {
          await supabase
            .from("player_discoveries")
            .insert({ player_id: playerId, artwork_id: selectedCard.id });
        }
      }
    }

    return {
      cost,
      inkWinnings,
      isJackpot,
      cardWon,
      isDuplicate,
      cardWonPaId,
    };
  }
}

module.exports = new GamblingService();
