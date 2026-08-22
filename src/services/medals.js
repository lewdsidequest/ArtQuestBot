const supabase = require("../database/supabase");
const economy = require("./economy");

class MedalsService {
  async evaluateAndGetMedals(playerId) {
    const { data: allMedals } = await supabase
      .from("medals")
      .select("*")
      .order("series_slug", { ascending: true })
      .order("tier", { ascending: true });

    const { data: playerMedals } = await supabase
      .from("player_medals")
      .select("medal_id, is_claimed")
      .eq("player_id", playerId);

    const unlockedMap = new Map();
    playerMedals?.forEach((pm) => unlockedMap.set(pm.medal_id, pm));

    const player = await economy.getPlayer(playerId);
    if (!player) throw new Error("Jugador no encontrado.");

    const getProgress = (medal) => {
      switch (medal.condition_type) {
        case "packs_opened":
          return player.lifetime_packs_opened || 0;
        case "casino_spent":
          return player.casino_spent || 0;
        case "highest_rarity":
          return player.highest_rarity_unlocked || 0;
        case "highest_level":
          return player.highest_card_level || 1;
        case "cards_evolved":
          return player.total_cards_evolved || 0;
        case "total_prestiges":
          return player.total_prestiges || 0; // 🛠️ NUEVO TRACKER
        case "ink_balance":
          return player.ink_dollars || 0;
        default:
          return 0;
      }
    };

    const newlyUnlocked = [];
    const displayUnlocked = [];
    const displayLocked = [];
    const seriesMap = new Map();

    for (const medal of allMedals) {
      const series = medal.series_slug || medal.slug;
      if (!seriesMap.has(series)) seriesMap.set(series, []);
      seriesMap.get(series).push(medal);
    }

    for (const [series, medalsInSeries] of seriesMap.entries()) {
      let nextLocked = null;

      for (const medal of medalsInSeries) {
        const isUnlocked = unlockedMap.has(medal.id);
        const isClaimed = isUnlocked
          ? unlockedMap.get(medal.id).is_claimed
          : false;
        const progress = getProgress(medal);
        const meetsCondition = progress >= medal.condition_value;

        // 🛠️ REPARACIÓN: Si cumple la condición, empujamos TODAS las medallas que apliquen, sin sobreescribir.
        if (meetsCondition) {
          if (!isUnlocked) {
            newlyUnlocked.push({
              player_id: playerId,
              medal_id: medal.id,
              is_claimed: false,
            });
            unlockedMap.set(medal.id, {
              medal_id: medal.id,
              is_claimed: false,
            });
          }
          medal.is_claimed = isClaimed;
          displayUnlocked.push(medal);
        }
        // Si no cumple la condición, capturamos solo el primer Tier bloqueado para mostrarlo como meta
        else if (!nextLocked) {
          nextLocked = medal;
          nextLocked.currentProgress = progress;
        }
      }

      if (nextLocked) {
        displayLocked.push(nextLocked);
      }
    }

    if (newlyUnlocked.length > 0) {
      await supabase.from("player_medals").insert(newlyUnlocked);
    }

    return {
      unlocked: displayUnlocked,
      locked: displayLocked,
      newlyUnlockedCount: newlyUnlocked.length,
    };
  }

  async claimMedalReward(playerId, medalId) {
    const { data: pm, error } = await supabase
      .from("player_medals")
      .select("is_claimed")
      .eq("player_id", playerId)
      .eq("medal_id", medalId)
      .single();

    if (error || !pm) throw new Error("No posees esta medalla.");
    if (pm.is_claimed) throw new Error("Ya reclamaste esta recompensa.");

    const { data: medal } = await supabase
      .from("medals")
      .select("*")
      .eq("id", medalId)
      .single();

    if (medal.reward_ink > 0) await economy.addInk(playerId, medal.reward_ink);
    if (medal.reward_dust > 0)
      await economy.addStarDust(playerId, medal.reward_dust);

    let cardAwarded = null;
    if (medal.reward_card_id) {
      const { data: newCard } = await supabase
        .from("player_artworks")
        .insert({
          player_id: playerId,
          artwork_id: medal.reward_card_id,
          stars: 1,
          level: 1,
          invested_ink: 0,
          invested_dust: 0,
        })
        .select("id")
        .single();
      cardAwarded = newCard?.id;
    }

    await supabase
      .from("player_medals")
      .update({ is_claimed: true })
      .eq("player_id", playerId)
      .eq("medal_id", medalId);

    return {
      ink: medal.reward_ink,
      dust: medal.reward_dust,
      cardId: cardAwarded,
    };
  }
}

module.exports = new MedalsService();
