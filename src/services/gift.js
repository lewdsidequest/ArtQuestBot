const supabase = require("../database/supabase");
const RarityManager = require("../utils/rarity");

class GiftService {
  async getGiftConfig() {
    const { data } = await supabase
      .from("global_configs")
      .select("value")
      .eq("key", "gift_restrictions")
      .single();
    return (
      data?.value || {
        max_daily: 3,
        max_level: 50,
        max_stars: 5,
        max_rarity_id: 4,
        max_prestige: 0,
      }
    );
  }

  async checkEligibility(senderId, paId) {
    // 1. Obtener al jugador y revisar límite diario
    const { data: player, error: pErr } = await supabase
      .from("players")
      .select("*")
      .eq("id", senderId)
      .single();

    if (pErr || !player)
      throw new Error("Jugador no encontrado en el sistema.");

    const today = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"
    let dailySent = player.daily_gifts_sent || 0;

    // Si la fecha guardada no es hoy, reseteamos su límite
    if (player.last_gift_date !== today) {
      dailySent = 0;
    }

    const config = await this.getGiftConfig();
    if (dailySent >= config.max_daily) {
      throw new Error(
        `Has alcanzado tu límite diario de **${config.max_daily} regalos** por hoy.`,
      );
    }

    // 2. Revisar la carta y los límites de estadísticas
    const { data: pa, error: paErr } = await supabase
      .from("player_artworks")
      .select("*, artworks(*)")
      .eq("id", paId)
      .eq("player_id", senderId)
      .single();

    if (paErr || !pa)
      throw new Error("No posees la carta con ese ID o el ID es incorrecto.");
    if (pa.is_loved) throw new Error("No puedes regalar tu Carta Amada.");
    if (pa.is_favorite)
      throw new Error(
        "La carta es favorita. Quítala de tus favoritos antes de regalarla.",
      );

    const currentRarityId = pa.rarity_id || pa.artworks.rarity_id;
    const currentRarity = RarityManager.get(currentRarityId);

    // 3. Validaciones de Balance
    if (pa.level > config.max_level)
      throw new Error(
        `El nivel máximo permitido para regalar es **${config.max_level}**.`,
      );
    if (pa.stars > config.max_stars)
      throw new Error(
        `Solo puedes regalar cartas con **${config.max_stars} estrellas** o menos.`,
      );
    if (pa.prestige_level > config.max_prestige)
      throw new Error(
        `No puedes regalar cartas que posean niveles de prestigio.`,
      );
    if (currentRarityId > config.max_rarity_id)
      throw new Error(
        `No puedes regalar cartas de rareza **${currentRarity?.name || "Alta"}** o superior.`,
      );

    return { pa, player, config, today, dailySent };
  }

  async executeGift(senderId, receiverId, paId, today, dailySent) {
    // 🛠️ TRANSFERENCIA ATÓMICA: Evita robos, duplicados o errores de giveaway
    const { data: updatedCard, error: updErr } = await supabase
      .from("player_artworks")
      .update({
        player_id: receiverId,
        is_favorite: false, // Por seguridad
      })
      .eq("id", paId)
      .eq("player_id", senderId) // Candado de seguridad vital
      .select();

    // Si data vuelve vacío, alguien más la agarró o el usuario la destruyó mientras la regalaba
    if (updErr || !updatedCard || updatedCard.length === 0) {
      throw new Error(
        "La carta ya no está disponible en tu inventario (fue transferida o destruida).",
      );
    }

    // Actualizar los contadores diarios del remitente
    await supabase
      .from("players")
      .update({
        daily_gifts_sent: dailySent + 1,
        last_gift_date: today,
      })
      .eq("id", senderId);

    return true;
  }
}

module.exports = new GiftService();
