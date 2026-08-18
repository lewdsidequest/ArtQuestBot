const supabase = require("../database/supabase");
const GAME = require("../config/game");
const RarityManager = require("../utils/rarity");
const economy = require("./economy");
const artworkService = require("./artwork");
const cacheService = require("./cache");

class PackService {
  async prestigeArtwork(playerId, playerArtworkId) {
    const { data: pa, error: paErr } = await supabase
      .from("player_artworks")
      .select("*, artworks(name, rarity_id)")
      .eq("id", playerArtworkId)
      .eq("player_id", playerId)
      .single();

    if (paErr || !pa) throw new Error("Artwork no encontrado.");

    const { data: configData } = await supabase
      .from("global_configs")
      .select("value")
      .eq("key", "game_modifiers")
      .maybeSingle();
    const maxLevel = configData?.value?.max_level || 100;
    const maxPrestige = configData?.value?.max_prestige || 99;

    if (pa.level < maxLevel)
      throw new Error(
        `Tu carta debe estar en el **Nivel Máximo (${maxLevel})** para hacer Prestigio.`,
      );
    if (pa.prestige_level >= maxPrestige)
      throw new Error(
        `Esta carta ya alcanzó el Prestigio Máximo permitido (${maxPrestige}).`,
      );

    const newPrestige = (pa.prestige_level || 0) + 1;

    const { error: updErr } = await supabase
      .from("player_artworks")
      .update({ level: 1, prestige_level: newPrestige })
      .eq("id", playerArtworkId);

    if (updErr)
      throw new Error(`Fallo al aplicar prestigio: ${updErr.message}`);
    return { newPrestige, artwork: pa.artworks };
  }

  async openPack(playerId, collectionSlug, username) {
    const collection =
      await artworkService.getCollectionWithConfigs(collectionSlug);
    if (!collection) throw new Error("Colección no encontrada o deshabilitada");
    if (!collection.configs.length)
      throw new Error("Esta colección no tiene configuraciones de rareza");

    const cost = this.calculatePackCost(collection);

    const playerCheck = await economy.getPlayer(playerId);
    if (!playerCheck || playerCheck.ink_dollars < cost.final)
      throw new Error("Fondos insuficientes");

    const { count: currentInventory } = await supabase
      .from("player_artworks")
      .select("*", { count: "exact", head: true })
      .eq("player_id", playerId);

    const invLimit =
      playerCheck.inventory_limit || GAME.economy.startingInventoryLimit;
    if ((currentInventory || 0) >= invLimit) {
      throw new Error(
        `Tu inventario está lleno (${currentInventory}/${invLimit}). Usa el comando /destroy para liberar espacio.`,
      );
    }

    // 🛠️ COBRAMOS PRIMERO PARA EVITAR EXPLOITS
    await economy.deductInk(playerId, cost.final);

    try {
      const rarityId = RarityManager.rollRarity(collection.configs);
      const rarityConfig = collection.configs.find(
        (c) => c.rarity_id === rarityId,
      );

      await cacheService.ensureCache(collection, rarityConfig);
      let artwork = await cacheService.getRandom(collection.id, rarityId);

      if (!artwork) {
        const apiModule = require("../api");
        const api = collection.default_api
          ? apiModule.getAdapter(collection.default_api)
          : apiModule.getDefaultAdapter();
        const results = await api.search({
          tags: collection.base_tags,
          extraTags: rarityConfig.search_extras || [],
          filters: collection.global_filters || [],
          limit: 10,
        });

        if (!results.length)
          throw new Error("La API no devolvió ninguna imagen.");

        const post = results[Math.floor(Math.random() * results.length)];
        artwork = await artworkService.findBySource(
          post.sourceApi,
          post.sourceId,
        );

        if (!artwork) {
          artwork = await artworkService.create(
            {
              collectionId: collection.id,
              sourceApi: post.sourceApi,
              sourceId: post.sourceId,
              imageUrl: post.imageUrl,
              sampleUrl: post.sampleUrl,
              tags: post.tags,
              score: post.score,
              rarity_id: rarityId,
            },
            playerId,
          );
        }
      }

      // 🛠️ PROTECCIÓN: Si la carta sigue siendo null, abortamos para no crashear
      if (!artwork)
        throw new Error(
          "El bot estaba descargando imagenes de esta coleccion...\n**Intentalo de nuevo, porfavor \\:)**",
        );

      const isNewGlobal = !artwork.discovered_by;
      if (isNewGlobal)
        await supabase
          .from("artworks")
          .update({ discovered_by: playerId })
          .eq("id", artwork.id);

      const { data: existingOwnership } = await supabase
        .from("player_artworks")
        .select("id")
        .eq("player_id", playerId)
        .eq("artwork_id", artwork.id)
        .limit(1);
      const isDuplicate = existingOwnership && existingOwnership.length > 0;
      const isNewPersonal = !isDuplicate;

      const initialPrestige = collection.tier || 0;

      const { data: playerArtwork, error: insertError } = await supabase
        .from("player_artworks")
        .insert({
          player_id: playerId,
          artwork_id: artwork.id,
          stars: 1,
          level: 1,
          prestige_level: initialPrestige,
          invested_ink: 0,
          invested_dust: 0,
        })
        .select()
        .single();

      if (insertError)
        throw new Error(
          "Error al guardar en el inventario: " + insertError.message,
        );

      if (isNewPersonal)
        await supabase
          .from("player_discoveries")
          .insert({ player_id: playerId, artwork_id: artwork.id });
      await supabase
        .from("players")
        .update({ total_packs: playerCheck.total_packs + 1 })
        .eq("id", playerId);

      // 🛠️ INCREMENTAMOS EL CONTADOR DE APERTURAS DE ESTA COLECCIÓN
      await supabase.rpc("increment_pack_opens", { col_id: collection.id });

      return {
        artwork,
        playerArtwork,
        rarityConfig,
        isNewGlobal,
        isNewPersonal,
        isDuplicate,
        cost,
      };
    } catch (error) {
      // 🛠️ SISTEMA DE REEMBOLSO: Si algo falló arriba, te devolvemos tu dinero
      await economy.addInk(playerId, cost.final);
      throw new Error(
        `Se te ha devuelto tu dinero.\n**Motivo:** ${error.message}`,
      );
    }
  }

  calculatePackCost(collection) {
    return {
      base: collection.base_price || 100,
      final: collection.final_price || 100,
      discount: collection.discount_percentage || 0,
    };
  }

  async upgradeLevel(playerId, playerArtworkId, targetLevel) {
    const { calculateLevelUpgradeCost } = require("../utils/power");
    const { data: pa, error: paErr } = await supabase
      .from("player_artworks")
      .select("*, artworks(name, rarity_id)")
      .eq("id", playerArtworkId)
      .eq("player_id", playerId)
      .single();
    if (paErr || !pa) throw new Error("Artwork no encontrado.");
    if (targetLevel <= pa.level)
      throw new Error("El nivel objetivo debe ser mayor al actual.");

    const { data: configData } = await supabase
      .from("global_configs")
      .select("value")
      .eq("key", "economy_costs")
      .maybeSingle();
    const ecoConfig = configData?.value || null;

    // Se inyecta pa.artworks.rarity_id en la 4ta posición
    const cost = calculateLevelUpgradeCost(
      pa.level,
      targetLevel,
      pa.prestige_level || 0,
      pa.artworks.rarity_id,
      ecoConfig,
    );

    await economy.deductInk(playerId, cost);

    const newInvestedInk = (pa.invested_ink || 0) + cost;
    const { error: updErr } = await supabase
      .from("player_artworks")
      .update({ level: targetLevel, invested_ink: newInvestedInk })
      .eq("id", playerArtworkId);
    if (updErr) throw new Error(`Fallo al subir de nivel: ${updErr.message}`);

    return { newLevel: targetLevel, cost, artwork: pa.artworks };
  }

  async upgradeStars(playerId, playerArtworkId, targetStars) {
    const { calculateStarUpgradeCost } = require("../utils/power");
    const { data: pa, error: paErr } = await supabase
      .from("player_artworks")
      .select("*, artworks(name, rarity_id)")
      .eq("id", playerArtworkId)
      .eq("player_id", playerId)
      .single();
    if (paErr || !pa) throw new Error("Artwork no encontrado.");
    if (targetStars <= pa.stars)
      throw new Error(
        "Las estrellas objetivo deben ser mayores a las actuales.",
      );
    if (targetStars > 10)
      throw new Error("No puedes superar el límite de 10 estrellas.");

    const { data: configData } = await supabase
      .from("global_configs")
      .select("value")
      .eq("key", "economy_costs")
      .maybeSingle();
    const ecoConfig = configData?.value || null;

    // 🛠️ CORREGIDO: Se inyecta pa.artworks.rarity_id en la 4ta posición
    const cost = calculateStarUpgradeCost(
      pa.stars,
      targetStars,
      pa.prestige_level || 0,
      pa.artworks.rarity_id,
      ecoConfig,
    );

    const player = await economy.getPlayer(playerId);
    if (!player || player.star_dust < cost)
      throw new Error("Polvo de Estrella insuficiente.");

    await economy.addStarDust(playerId, -cost);

    const newInvestedDust = (pa.invested_dust || 0) + cost;
    const { error: updErr } = await supabase
      .from("player_artworks")
      .update({ stars: targetStars, invested_dust: newInvestedDust })
      .eq("id", playerArtworkId);
    if (updErr)
      throw new Error(`Fallo al mejorar estrellas: ${updErr.message}`);

    return { newStars: targetStars, cost, artwork: pa.artworks };
  }

  async convertToDust(playerId, playerArtworkId) {
    const { data: pa, error } = await supabase
      .from("player_artworks")
      .select("*, artworks(rarity_id)")
      .eq("id", playerArtworkId)
      .eq("player_id", playerId)
      .maybeSingle();
    const { data: configData } = await supabase
      .from("global_configs")
      .select("value")
      .eq("key", "economy_costs")
      .maybeSingle();
    const ecoConfig = configData?.value || null;

    if (error || !pa)
      throw new Error(
        "No posees ninguna carta con este ID o el ID es incorrecto.",
      );
    if (pa.is_loved) throw new Error("No puedes destruir tu Carta Amada.");

    const { calculateRefund } = require("../utils/power");
    const refund = calculateRefund(
      pa.invested_ink,
      pa.invested_dust,
      pa.artworks.rarity_id,
      pa.prestige_level || 0,
      ecoConfig,
    );

    await supabase.from("player_artworks").delete().eq("id", playerArtworkId);

    const newDust = await economy.addStarDust(playerId, refund.refundedDust);
    if (refund.refundedInk > 0)
      await economy.addInk(playerId, refund.refundedInk);

    // 🛠️ Obtenemos el nombre para mostrarlo en el Embed del comando Destroy
    const rarityData = RarityManager.get(pa.artworks.rarity_id);
    const rarityName = rarityData ? rarityData.name : "Unknown";

    return {
      dustReward: refund.refundedDust,
      inkReward: refund.refundedInk,
      newDust,
      rarity: rarityName,
    };
  }

  async getDestructibleDuplicates(playerId) {
    const galleryService = require("./gallery");
    const { items: duplicates } = await galleryService.getDuplicates(
      playerId,
      1,
      1000,
    );
    const byArtworkId = {};

    for (const dup of duplicates) {
      if (!byArtworkId[dup.artwork_id]) byArtworkId[dup.artwork_id] = [];
      byArtworkId[dup.artwork_id].push(dup);
    }

    const { data: configData } = await supabase
      .from("global_configs")
      .select("value")
      .eq("key", "economy_costs")
      .maybeSingle();
    const ecoConfig = configData?.value || null;
    const { calculateRefund } = require("../utils/power");

    const toDestroy = [];
    let totalDust = 0;
    let totalInk = 0;
    let hasHighRarity = false;

    for (const artId in byArtworkId) {
      const copies = byArtworkId[artId];
      if (copies.length < 2) continue;

      copies.sort((a, b) => b.level - a.level || b.stars - a.stars);
      const safeCopyId = copies[0].id;

      for (const copy of copies) {
        if (
          copy.id === safeCopyId ||
          copy.level > 1 ||
          copy.stars > 1 ||
          copy.prestige_level > 0 ||
          copy.is_loved
        )
          continue;

        toDestroy.push(copy.id);
        const refund = calculateRefund(
          copy.invested_ink,
          copy.invested_dust,
          copy.artworks.rarity_id,
          pa.prestige_level || 0,
          ecoConfig,
        );

        totalDust += refund.refundedDust;
        totalInk += refund.refundedInk;

        // 🛠️ Protección usando el peso de la base de datos (270 = Legendario o superior)
        const rarityData = RarityManager.get(copy.artworks.rarity_id);
        if (rarityData && rarityData.weight_score >= 270) hasHighRarity = true;
      }
    }

    return {
      toDestroy,
      totalDust,
      totalInk,
      hasHighRarity,
      count: toDestroy.length,
    };
  }

  async getDestructibleAll(playerId) {
    const topGenerators = await economy.getTopGeneratorsDetails(playerId);
    const protectedIds = topGenerators.map((g) => g.id);

    const { data: allCards, error } = await supabase
      .from("player_artworks")
      .select(
        "id, level, stars, prestige_level, invested_ink, invested_dust, is_loved, is_favorite, artworks!inner(rarity_id, status)",
      )
      .eq("player_id", playerId)
      .eq("artworks.status", "active")
      .eq("is_loved", false)
      .eq("is_favorite", false);

    if (error) throw new Error("Error al consultar tu inventario.");

    const { data: configData } = await supabase
      .from("global_configs")
      .select("value")
      .eq("key", "economy_costs")
      .maybeSingle();
    const ecoConfig = configData?.value || null;
    const { calculateRefund } = require("../utils/power");

    const toDestroy = [];
    let totalDust = 0;
    let totalInk = 0;
    let hasHighRarity = false;

    for (const card of allCards || []) {
      if (protectedIds.includes(card.id)) continue;

      toDestroy.push(card.id);
      const refund = calculateRefund(
        card.invested_ink,
        card.invested_dust,
        card.artworks.rarity_id,
        pa.prestige_level || 0,
        ecoConfig,
      );

      totalDust += refund.refundedDust;
      totalInk += refund.refundedInk;

      const rarityData = RarityManager.get(card.artworks.rarity_id);
      if (rarityData && rarityData.weight_score >= 270) hasHighRarity = true;
    }

    return {
      toDestroy,
      totalDust,
      totalInk,
      hasHighRarity,
      count: toDestroy.length,
    };
  }

  async executeMassDestroy(playerId, idsToDestroy, totalDust, totalInk = 0) {
    if (!idsToDestroy.length) return { newDust: 0, newInk: 0 };

    const { error } = await supabase
      .from("player_artworks")
      .delete()
      .in("id", idsToDestroy)
      .eq("player_id", playerId);
    if (error) throw new Error("Error al eliminar los duplicados.");

    const newDust = await economy.addStarDust(playerId, totalDust);
    let newInk = 0;
    if (totalInk > 0) newInk = await economy.addInk(playerId, totalInk);

    return { newDust, newInk };
  }

  async toggleFavorite(playerId, playerArtworkId) {
    const { data: pa } = await supabase
      .from("player_artworks")
      .select("is_favorite")
      .eq("id", playerArtworkId)
      .eq("player_id", playerId)
      .single();
    if (!pa) throw new Error("Artwork no encontrado");
    const { error } = await supabase
      .from("player_artworks")
      .update({ is_favorite: !pa.is_favorite })
      .eq("id", playerArtworkId);
    if (error) throw new Error("Error al cambiar favorito");
    return !pa.is_favorite;
  }
}

module.exports = new PackService();
