const supabase = require("../database/supabase");
const GAME = require("../config/game");
const { getDefaultAdapter, getAdapter } = require("../api");

class CacheService {
  /**
   * Get a random artwork from cache for a collection+rarity combo.
   */
  async getRandom(collectionId, rarityId) {
    const { data, error } = await supabase
      .from("cache_pool")
      .select("artwork_id, artworks(*)")
      .eq("collection_id", collectionId)
      .eq("rarity_id", rarityId) // 🛠️ CORREGIDO
      .order("id", { ascending: false })
      .limit(50);

    if (error || !data?.length) return null;

    const pick = data[Math.floor(Math.random() * data.length)];
    return pick.artworks;
  }

  /**
   * Count cache entries for a combo.
   */
  async count(collectionId, rarityId) {
    const { count, error } = await supabase
      .from("cache_pool")
      .select("*", { count: "exact", head: true })
      .eq("collection_id", collectionId)
      .eq("rarity_id", rarityId); // 🛠️ CORREGIDO

    if (error) return 0;
    return count || 0;
  }

  /**
   * Check if cache needs refill and trigger background refill if so.
   */
  async ensureCache(collection, rarityConfig) {
    // 🛠️ Pasamos rarity_id
    const currentCount = await this.count(
      collection.id,
      rarityConfig.rarity_id,
    );

    if (currentCount >= GAME.cache.refreshThreshold) {
      return { refilled: false, count: currentCount };
    }

    const adapterName = collection.default_api || null;

    this.refillCache(collection, rarityConfig, adapterName).catch((err) => {
      console.error("[Cache] Background refill error:", err.message);
    });

    return { refilled: true, count: currentCount };
  }

  /**
   * Refill cache by querying the image API.
   */
  async refillCache(collection, rarityConfig, adapterName = null) {
    const api = adapterName ? getAdapter(adapterName) : getDefaultAdapter();

    const needed = GAME.cache.target;
    let added = 0;
    let page = 0;

    const extraTags = rarityConfig.search_extras || [];
    const filters = collection.global_filters || [];

    while (added < needed && page < 10) {
      const results = await api.search({
        tags: collection.base_tags,
        extraTags,
        filters,
        limit: GAME.cache.batchSize,
        page: page * GAME.cache.batchSize,
      });

      if (!results.length) break;

      for (const post of results) {
        const { data: existing } = await supabase
          .from("artworks")
          .select("id")
          .eq("source_api", post.sourceApi)
          .eq("source_id", post.sourceId)
          .maybeSingle();

        let artworkId = existing?.id;

        if (!artworkId) {
          const nextNum = await this._getNextCollectionNum(collection.id);
          const { data: newArt } = await supabase
            .from("artworks")
            .insert({
              collection_id: collection.id,
              collection_num: nextNum,
              name: `${collection.name} Art #${String(nextNum).padStart(4, "0")}`,
              source_api: post.sourceApi,
              source_id: post.sourceId,
              image_url: post.imageUrl,
              sample_url: post.sampleUrl,
              artist: post.artist,
              characters: post.characters,
              series: post.series,
              tags: post.tags,
              score: post.score,
              rarity_id: rarityConfig.rarity_id, // 🛠️ CORREGIDO
              status: "active",
            })
            .select("id")
            .single();

          if (newArt) artworkId = newArt.id;
        }

        if (!artworkId) continue;

        await supabase
          .from("cache_pool")
          .insert({
            collection_id: collection.id,
            rarity_id: rarityConfig.rarity_id, // 🛠️ CORREGIDO
            artwork_id: artworkId,
            source_api: post.sourceApi,
          })
          .then(() => {
            added++;
          })
          .catch(() => {
            /* duplicate or error, skip */
          });
      }

      page++;
    }

    console.log(
      `[Cache] Refilled ${collection.name}/ID:${rarityConfig.rarity_id} via ${api.name}: +${added} entries`,
    );
    return added;
  }

  async _getNextCollectionNum(collectionId) {
    const { data } = await supabase
      .from("artworks")
      .select("collection_num")
      .eq("collection_id", collectionId)
      .order("collection_num", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.collection_num || 0) + 1;
  }

  async prune() {
    const cutoff = new Date(
      Date.now() - GAME.cache.maxAgeHours * 60 * 60 * 1000,
    ).toISOString();
    const { error } = await supabase
      .from("cache_pool")
      .delete()
      .lt("created_at", cutoff);

    if (error) console.error("[Cache] Prune error:", error.message);
  }
}

module.exports = new CacheService();
