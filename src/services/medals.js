const supabase = require("../database/supabase");
const economy = require("./economy");

class MedalsService {
  async evaluateAndGetMedals(playerId) {
    // 1. Obtener todas las medallas del juego
    const { data: allMedals } = await supabase
      .from("medals")
      .select("*")
      .order("condition_value", { ascending: true });

    // 2. Obtener las medallas que el jugador YA tiene guardadas
    const { data: playerMedals } = await supabase
      .from("player_medals")
      .select("medal_id")
      .eq("player_id", playerId);

    const unlockedIds = new Set(playerMedals?.map((pm) => pm.medal_id) || []);

    // 3. Consultar las estadísticas actuales del jugador para evaluar su progreso
    const player = await economy.getPlayer(playerId);

    // Total de cartas obtenidas (para medallas tipo 'count')
    const { count: totalArtworks } = await supabase
      .from("player_artworks")
      .select("*", { count: "exact", head: true })
      .eq("player_id", playerId);

    // Total de cartas en galería
    const { count: galleryCount } = await supabase
      .from("player_artworks")
      .select("*", { count: "exact", head: true })
      .eq("player_id", playerId)
      .eq("is_in_gallery", true);

    // Rarezas obtenidas (para medallas tipo 'rarity')
    const { data: raritiesData } = await supabase
      .from("player_artworks")
      .select("artworks!inner(rarity)")
      .eq("player_id", playerId);
    const ownedRarities = new Set(
      raritiesData?.map((pa) => pa.artworks.rarity) || [],
    );

    // 🛠️ DICCIONARIO DE PROGRESO ADAPTADO A TUS DATOS REALES
    const getProgress = (medal) => {
      if (medal.condition_type === "count") {
        if (medal.slug === "master_gallery") return galleryCount || 0;
        return totalArtworks || 0; // collector_10, collector_100, first_steps
      }
      if (medal.condition_type === "ink") return player?.ink_dollars || 0;
      if (medal.condition_type === "rarity") {
        if (medal.slug.includes("legendary") && ownedRarities.has("Legendary"))
          return 1;
        if (medal.slug.includes("celestial") && ownedRarities.has("Celestial"))
          return 1;
        return 0;
      }
      return 0;
    };

    // 4. Evaluar cuáles medallas NUEVAS acaba de cumplir
    const newlyUnlocked = [];
    for (const medal of allMedals) {
      if (!unlockedIds.has(medal.id)) {
        const progress = getProgress(medal);
        if (progress >= medal.condition_value) {
          newlyUnlocked.push({ player_id: playerId, medal_id: medal.id });
          unlockedIds.add(medal.id); // Lo marcamos como desbloqueado en memoria
        }
      }
    }

    // 5. ¡Guardar las nuevas medallas en la base de datos!
    if (newlyUnlocked.length > 0) {
      await supabase.from("player_medals").insert(newlyUnlocked);
    }

    // 6. Lógica de "Series" (Agrupar medallas relacionadas)
    // Agrupamos por el prefijo del slug (ej. 'collector_10' y 'collector_100' son de la serie 'collector')
    const getSeries = (slug) => {
      if (slug.startsWith("collector_")) return "collector";
      if (slug.startsWith("rich_")) return "rich";
      return slug; // Si no tiene serie, es una medalla independiente
    };

    const seriesMap = new Map();
    for (const medal of allMedals) {
      const series = getSeries(medal.slug);
      if (!seriesMap.has(series)) seriesMap.set(series, []);
      seriesMap.get(series).push(medal);
    }

    const displayUnlocked = [];
    const displayLocked = [];

    // Iteramos sobre cada serie para extraer solo la más alta y la siguiente
    for (const [series, medalsInSeries] of seriesMap.entries()) {
      medalsInSeries.sort((a, b) => a.condition_value - b.condition_value);

      let highestUnlocked = null;
      let nextLocked = null;

      for (const medal of medalsInSeries) {
        if (unlockedIds.has(medal.id)) {
          highestUnlocked = medal;
        } else if (!nextLocked) {
          nextLocked = medal; // Solo atrapamos la primera bloqueada
        }
      }

      if (highestUnlocked) displayUnlocked.push(highestUnlocked);
      if (nextLocked) {
        nextLocked.currentProgress = getProgress(nextLocked);
        displayLocked.push(nextLocked);
      }
    }

    return {
      unlocked: displayUnlocked,
      locked: displayLocked,
      newlyUnlockedCount: newlyUnlocked.length,
    };
  }
}

module.exports = new MedalsService();
