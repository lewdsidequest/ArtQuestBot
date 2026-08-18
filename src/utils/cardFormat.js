const RarityManager = require("./rarity");

/**
 * Formatea la información de una carta en una cadena de texto estandarizada.
 * @param {Object} item - El objeto player_artwork (debe incluir artworks).
 * @param {String} formatType - "detailed", "intermediate", "minimalist".
 * @param {Number|null} index - Índice absoluto para enumerar la lista (opcional).
 */
function formatCardText(item, formatType = "detailed", index = null) {
  const pa = item;
  const art = item.artworks;

  const loved = pa.is_loved ? "💘 " : "";
  const fav = pa.is_favorite ? "💎 " : "";
  const prestige = pa.prestige_level > 0 ? ` - 💠${pa.prestige_level}` : "";

  // 🛠️ ACTUALIZACIÓN: Leemos de la BD. Si es null (cartas viejas), usa Regex de respaldo.
  const isVid =
    art.is_video ??
    (art.image_url && art.image_url.match(/\.(mp4|webm)$/i) !== null);
  const isGif =
    art.is_gif ?? (art.image_url && art.image_url.match(/\.(gif)$/i) !== null);

  const rarityData = RarityManager.get(art.rarity_id);
  const rarityName = rarityData ? rarityData.name : "Unknown";
  const rarityEmoji = rarityData ? rarityData.emoji : "Undefined";

  const numPrefix = index !== null ? `**${index}.** ` : "";
  let text = "";

  if (formatType === "detailed") {
    const mediaText = isVid ? "*VIDEO* " : isGif ? "*GIF* " : "";
    text = `${numPrefix}${loved}${fav}${mediaText}(${rarityName}) **${art.name}** | 🆔${pa.id} | ⭐${pa.stars} - Nv. ${pa.level}${prestige}`;
  } else if (formatType === "intermediate") {
    const mediaEmoji = isVid ? "🎥 " : isGif ? "🎞️ " : "";
    text = `${numPrefix}${loved}${fav}${mediaEmoji}(${rarityEmoji}) **${art.name}** | 🆔${pa.id} | ⭐${pa.stars} - Nv. ${pa.level}${prestige}`;
  } else if (formatType === "minimalist") {
    text = `${numPrefix}(${rarityEmoji}) **${art.name}** | 🆔${pa.id}`;
  }

  return text;
}

module.exports = { formatCardText };
