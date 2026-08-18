const supabase = require("../database/supabase");

class ArtworkService {
  async findBySource(sourceApi, sourceId) {
    const { data, error } = await supabase
      .from("artworks")
      .select("*")
      .eq("source_api", sourceApi)
      .eq("source_id", String(sourceId))
      .maybeSingle();
    if (error) return null;
    return data;
  }

  async create(artworkData, discovererId) {
    const {
      collectionId,
      sourceApi,
      sourceId,
      imageUrl,
      sampleUrl,
      tags,
      score,
      rarity_id,
    } = artworkData;

    const { data: maxNum } = await supabase
      .from("artworks")
      .select("collection_num")
      .eq("collection_id", collectionId)
      .order("collection_num", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextNum = (maxNum?.collection_num || 0) + 1;
    const collectionName =
      (await this.getCollectionName(collectionId)) || "Art";
    const name = `${collectionName} Art #${String(nextNum).padStart(4, "0")}`;

    // 🛠️ ACTUALIZACIÓN: Detección de formato multimedia
    const isVideo = imageUrl ? /\.(mp4|webm)$/i.test(imageUrl) : false;
    const isGif = imageUrl ? /\.(gif)$/i.test(imageUrl) : false;

    const { data, error } = await supabase
      .from("artworks")
      .insert({
        collection_id: collectionId,
        collection_num: nextNum,
        name,
        source_api: sourceApi,
        source_id: String(sourceId),
        image_url: imageUrl,
        sample_url: sampleUrl,
        tags: tags || [],
        score: score || 0,
        rarity_id,
        discovered_by: discovererId,
        status: "active",
        is_video: isVideo,
        is_gif: isGif,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return this.findBySource(sourceApi, sourceId);
      throw new Error(`Failed to create artwork: ${error.message}`);
    }
    return data;
  }

  async getCollectionName(collectionId) {
    const { data } = await supabase
      .from("collections")
      .select("name")
      .eq("id", collectionId)
      .single();
    return data?.name;
  }

  async getCollectionWithConfigs(slug) {
    const { data: collection, error: cErr } = await supabase
      .from("collections")
      .select("*")
      .eq("slug", slug)
      .eq("is_visible", true) // 🛠️ ACTUALIZADO
      .single();

    if (cErr || !collection) return null;

    const { data: configs } = await supabase
      .from("rarity_configs")
      .select("*")
      .eq("collection_id", collection.id)
      .eq("enabled", true);
    return { ...collection, configs: configs || [] };
  }

  async listCollections() {
    const { data, error } = await supabase
      .from("collections")
      .select("*, rarity_configs(*)")
      .eq("is_visible", true)
      .order("id");
    if (error) return [];
    return data || [];
  }

  // 🛠️ NUEVA FUNCIÓN: Genera la tienda rotativa usando una semilla basada en la fecha
  async getDailyStore() {
    const { data: configData } = await supabase
      .from("global_configs")
      .select("value")
      .eq("key", "daily_store")
      .maybeSingle();
    const storeConfig = configData?.value;

    const allVisible = await this.listCollections();
    const available = allVisible.filter((c) => !c.is_special); // Ocultar especiales

    if (!storeConfig) return available; // Fallback

    const todayDay = new Date().getUTCDay(); // 0 a 6
    const todayConfig = storeConfig[String(todayDay)];
    if (!todayConfig) return available;

    let storeCollections = [];

    // 1. Añadir colecciones fijas del día por slug
    if (todayConfig.fixed && todayConfig.fixed.length > 0) {
      storeCollections.push(
        ...available.filter((c) => todayConfig.fixed.includes(c.slug)),
      );
    }

    // 2. Añadir aleatorias con Semilla Matemática (para que no cambien en todo el día)
    const dateStr = new Date().toISOString().split("T")[0];
    const seed = dateStr.replace(/-/g, "") + todayDay; // ej: "202608134"

    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (Math.imul(31, hash) + seed.charCodeAt(i)) | 0;
    }

    // Función de aleatoriedad generada por la semilla
    const seededRandom = () => {
      hash = (hash * 9301 + 49297) % 233280;
      return hash / 233280;
    };

    if (todayConfig.random) {
      for (const req of todayConfig.random) {
        let tierPool = available.filter(
          (c) =>
            c.tier === req.tier &&
            !storeCollections.find((sc) => sc.id === c.id),
        );
        tierPool.sort(() => seededRandom() - 0.5); // Mezclar usando la semilla
        storeCollections.push(...tierPool.slice(0, req.count));
      }
    }

    return storeCollections;
  }

  async getById(id) {
    const { data, error } = await supabase
      .from("artworks")
      .select("*")
      .eq("id", id)
      .single();
    if (error) return null;
    return data;
  }

  async reportArtwork(artworkId, playerId) {
    const strPlayerId = String(playerId);
    const { data: report } = await supabase
      .from("artwork_reports")
      .select("*")
      .eq("artwork_id", artworkId)
      .maybeSingle();

    let currentCount = 0;

    if (!report) {
      const { error } = await supabase.from("artwork_reports").insert({
        artwork_id: artworkId,
        reported_by_users: [strPlayerId],
        report_count: 1,
      });
      if (error)
        throw new Error("No se pudo enviar el reporte a la base de datos.");
      currentCount = 1;
    } else {
      const uniqueUsers = new Set(report.reported_by_users || []);
      if (uniqueUsers.has(strPlayerId))
        throw new Error("Ya has reportado este artwork.");

      uniqueUsers.add(strPlayerId);
      const updatedUsers = Array.from(uniqueUsers);
      currentCount = updatedUsers.length;

      const { error } = await supabase
        .from("artwork_reports")
        .update({
          reported_by_users: updatedUsers,
          report_count: currentCount,
          updated_at: new Date().toISOString(),
        })
        .eq("artwork_id", artworkId);
      if (error) throw new Error("No se pudo actualizar el reporte.");
    }

    const { data: configData } = await supabase
      .from("global_configs")
      .select("value")
      .eq("key", "moderation")
      .maybeSingle();
    const hideThreshold = configData?.value?.hide_report_threshold || 3;

    if (currentCount >= hideThreshold) {
      await supabase
        .from("artworks")
        .update({ status: "hidden" })
        .eq("id", artworkId);
      return { hidden: true, currentCount };
    }
    return { hidden: false, currentCount };
  }
}

module.exports = new ArtworkService();
