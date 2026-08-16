const supabase = require("../database/supabase");
const RarityManager = require("../utils/rarity");

class GalleryService {
  async getGallery(playerId, page = 1, perPage = 2) {
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    const { data, error, count } = await supabase
      .from("player_artworks")
      .select(
        "*, artworks!inner(*, collections!artworks_collection_id_fkey(name))",
        {
          count: "exact",
        },
      )
      .eq("player_id", playerId)
      .eq("artworks.status", "active") // 🛠️ Filtro principal
      .order("level", { ascending: false })
      .order("stars", { ascending: false })
      .order("is_favorite", { ascending: false })
      .range(from, to);

    if (error) return { items: [], total: 0 };
    return { items: data || [], total: count || 0 };
  }

  async getInventory(playerId, page = 1, perPage = 10, sortBy = "recent") {
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    let query = supabase
      .from("player_artworks")
      .select(
        "*, artworks!inner(*, collections!artworks_collection_id_fkey(name))",
        { count: "exact" },
      )
      .eq("player_id", playerId)
      .eq("artworks.status", "active"); // Filtro principal

    if (sortBy !== "rarity") {
      switch (sortBy) {
        case "level":
          query = query
            .order("level", { ascending: false })
            .order("stars", { ascending: false });
          break;
        case "stars":
          query = query
            .order("stars", { ascending: false })
            .order("level", { ascending: false });
          break;
        case "power":
          query = query
            .order("level", { ascending: false })
            .order("stars", { ascending: false });
          break;
        case "name":
          query = query
            .order("artwork_id", { ascending: true })
            .order("level", { ascending: false });
          break;
        case "recent":
        default:
          query = query.order("obtained_at", { ascending: false });
          break;
      }

      const { data, error, count } = await query.range(from, to);
      if (error) return { items: [], total: 0 };
      return { items: data || [], total: count || 0 };
    }

    const { data, error } = await query;
    if (error) return { items: [], total: 0 };

    // 🛠️ ORDENAMIENTO POR RAREZA USANDO LA BASE DE DATOS EN MEMORIA
    const sortedData = (data || []).sort((a, b) => {
      const rarityA = RarityManager.get(a.artworks.rarity_id);
      const rarityB = RarityManager.get(b.artworks.rarity_id);

      const weightA = rarityA ? rarityA.weight_score : 0;
      const weightB = rarityB ? rarityB.weight_score : 0;

      if (weightB !== weightA) return weightB - weightA;
      if (b.level !== a.level) return b.level - a.level;
      return b.stars - a.stars;
    });

    const paginatedItems = sortedData.slice(from, to + 1);
    return { items: paginatedItems, total: sortedData.length };
  }

  async getDuplicates(playerId, page = 1, perPage = 10) {
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    const { data, error } = await supabase
      .from("player_artworks")
      .select("*, artworks!inner(*)")
      .eq("player_id", playerId)
      .eq("artworks.status", "active") // 🛠️ Evita destruir cartas ocultas
      .order("artwork_id");

    if (error) return { items: [], total: 0 };

    const counts = {};
    for (const item of data) {
      counts[item.artwork_id] = (counts[item.artwork_id] || 0) + 1;
    }

    const duplicates = data.filter((item) => counts[item.artwork_id] > 1);
    const paginated = duplicates.slice(from, to + 1);

    return { items: paginated, total: duplicates.length };
  }

  async getPlayerArtwork(playerId, playerArtworkId) {
    const { data, error } = await supabase
      .from("player_artworks")
      .select(
        "*, artworks!inner(*, collections!artworks_collection_id_fkey(name))",
      )
      .eq("id", playerArtworkId)
      .eq("player_id", playerId)
      .eq("artworks.status", "active") // 🛠️ Filtro
      .single();

    if (error) return null;
    return data;
  }

  async getCollectionProgress(playerId) {
    const { data: collections } = await supabase
      .from("collections")
      .select("id, name, slug");

    // Solo contar descubrimientos de cartas que sigan activas
    const { data: discoveries } = await supabase
      .from("player_discoveries")
      .select("artwork_id, artworks!inner(collection_id)")
      .eq("player_id", playerId)
      .eq("artworks.status", "active");

    const { data: totals } = await supabase
      .from("artworks")
      .select("collection_id")
      .eq("status", "active");

    const result = [];
    for (const col of collections || []) {
      const total = (totals || []).filter(
        (a) => a.collection_id === col.id,
      ).length;
      const owned = (discoveries || []).filter(
        (d) => d.artworks?.collection_id === col.id,
      ).length;
      result.push({
        name: col.name,
        slug: col.slug,
        owned,
        total,
        percent: total > 0 ? Math.floor((owned / total) * 100) : 0,
      });
    }

    return result;
  }

  async getLeaderboard(type = "ink", limit = 10) {
    let query = supabase
      .from("players")
      .select("id, username, ink_dollars, total_claimed");
    if (type === "ink")
      query = query.order("ink_dollars", { ascending: false });
    else if (type === "claimed")
      query = query.order("total_claimed", { ascending: false });

    const { data, error } = await query.limit(limit);
    if (error) return [];
    return data || [];
  }
}

module.exports = new GalleryService();
