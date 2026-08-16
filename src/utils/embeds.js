const { EmbedBuilder } = require("discord.js");
const RarityManager = require("./rarity");

/**
 * Build a standardized artwork embed.
 */
function buildArtworkEmbed(artwork, options = {}) {
  const {
    playerArtwork = null,
    isNewGlobal = false,
    isNewPersonal = false,
    ownerUsername = "Desconocido",
    collectionName = "Desconocida",
    showVideoText = false,
  } = options;

  // Usamos el RarityManager para obtener los datos de la BD
  const rarityData = RarityManager.get(artwork.rarity_id);
  const colorHex = rarityData ? parseInt(rarityData.color_hex, 16) : 0x888888;
  const rarityName = rarityData ? rarityData.name : "Unknown";
  const rarityEmoji = rarityData ? rarityData.emoji : "";

  const uniqueId = playerArtwork ? playerArtwork.id : artwork.id || "N/A";

  const isVideo =
    artwork.image_url && artwork.image_url.match(/\.(mp4|webm)$/i);
  const isGif = artwork.image_url && artwork.image_url.match(/\.(gif)$/i);

  let displayImageUrl = artwork.sample_url;
  if (isGif) displayImageUrl = artwork.image_url;

  const sep = displayImageUrl.includes("?") ? "&" : "?";
  const safeImageUrl = `${displayImageUrl}${sep}_uid=${uniqueId}`;

  const embed = new EmbedBuilder()
    .setColor(colorHex)
    .setTitle(artwork.name)
    .setImage(safeImageUrl)
    .setURL(artwork.image_url);

  const fields = [];

  if (playerArtwork) {
    const stars = RarityManager.formatStars(playerArtwork.stars);
    const prestigeDisplay =
      playerArtwork.prestige_level > 0
        ? ` 💠${playerArtwork.prestige_level}`
        : "";

    fields.push({
      name: "⭐ Stats",
      value: `**Level:** ${playerArtwork.level}${prestigeDisplay}\n**Stars: ${stars}**`,
      inline: true,
    });
  }

  // 🛠️ Display dinámico desde BD
  const rarityDisplay = `${rarityName} ${rarityEmoji}`;

  fields.push(
    { name: "🆔 Unique ID", value: String(uniqueId), inline: true },
    { name: "🏷️ Rareza", value: rarityDisplay, inline: true },
  );

  embed.addFields(fields);

  const badges = [];

  if (isVideo) {
    if (showVideoText === true)
      badges.push("🎥 **Video/Animación** *(Usa el botón para verlo)*");
    else if (typeof showVideoText === "string")
      badges.push(`🎥 **Video/Animación** *(${showVideoText})*`);
  }

  if (isGif)
    badges.push(
      "🎞️ **GIF Animado** *(Puede tardar en cargar dependiendo de tu conexión)*",
    );
  if (isNewGlobal) badges.push("🌟 **¡Nuevo artwork descubierto!**");
  if (isNewPersonal) badges.push("🎉 **¡Nuevo para tu galería!**");
  if (playerArtwork?.is_favorite) badges.push("💎 Favorito");

  if (badges.length) embed.setDescription(badges.join("\n"));

  embed.setFooter({
    text: `Propietario: ${ownerUsername} | Colección: ${collectionName}`,
  });

  return embed;
}

/**
 * Build a profile/stats embed.
 */
// Añadimos targetUser como segundo parámetro
function buildProfileEmbed(
  player,
  targetUser,
  inkRate,
  bestCard = null,
  activeGeneratorsCount = 0,
  medalsText = "",
) {
  const RarityManager = require("./rarity");

  // Establecer el color. Si tiene carta amada, usamos rosa. Si no, verde.
  const isLoved = bestCard && bestCard.is_loved;
  const embedColor = isLoved ? 0xff1493 : 0x2ecc71;
  const profileTitle = `🎨 Perfil de Galería de ${player.username || "Jugador"}`;

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(profileTitle)
    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
    .addFields(
      {
        name: "💰 Ink Dollars",
        value: String(player.ink_dollars),
        inline: true,
      },
      {
        name: "✨ Polvo de Estrella",
        value: String(player.star_dust),
        inline: true,
      },
      {
        name: "📈 Ingresos",
        value: `${Math.floor(inkRate || 0)} Ink$/hora`,
        inline: true,
      },
      {
        name: "🖼️ Cartas generando Ink$",
        value: `${activeGeneratorsCount} / ${player.generator_limit}`,
        inline: true,
      },
      {
        name: "📦 Sobres abiertos",
        value: String(player.total_packs),
        inline: true,
      },
      {
        name: "💵 Total reclamado",
        value: String(player.total_claimed),
        inline: true,
      },
    )
    .setFooter({
      text: `ID: ${player.id} | Registrado desde ${new Date(player.joined_at).toLocaleDateString()}`,
    });

  // Si enviamos una carta destacada, la añadimos
  if (bestCard) {
    const featuredTitle = isLoved ? "💖 Carta Amada" : "🏆 Mejor Carta";

    // Aprovechamos nuestro nuevo formateador minimalista para los detalles
    const { formatCardText } = require("./cardFormat");
    const bestCardDesc = formatCardText(bestCard, "minimalist");

    // Añadimos el aviso de video si aplica
    const isVideo =
      bestCard.artworks.image_url &&
      bestCard.artworks.image_url.match(/\.(mp4|webm)$/i);
    const videoNotice = isVideo ? "\n🎥 *(Video/Animación: Usa /view)*" : "";

    // Agregamos el tip si no es una carta amada
    const loveTip = !isLoved ? "\n*(Usa `/love` para destacar una carta)*" : "";

    embed.addFields({
      name: featuredTitle,
      value: `${bestCardDesc}${videoNotice}${loveTip}`,
      inline: false,
    });

    embed.setImage(bestCard.artworks.sample_url || bestCard.artworks.image_url);
  }

  // Agregamos las medallas
  if (medalsText) {
    embed.addFields({
      name: "🏅 Top 5 Medallas",
      value: medalsText,
      inline: false,
    });
  }

  return embed;
}

/**
 * Build a pack opening embed.
 */
function buildPackEmbed(collection, cost) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📦 Sobre: ${collection.name}`);

  let priceText = `Costo: **${cost.final}** Ink Dollars`;
  if (cost.discount > 0)
    priceText = `Costo: ~~${cost.base}~~ **${cost.final}** Ink Dollars\n🎉 **¡${cost.discount}% de DESCUENTO ACTIVO!**`;

  let desc = `${priceText}\n\n¡Abre el sobre para revelar tu artwork!`;

  // 🛠️ Añadimos los tags debajo de la instrucción si existen
  if (collection.content_tags) {
    desc += `\n\n🏷️ **Contenido:**\n*${collection.content_tags}*`;
  }

  embed.setDescription(desc);

  if (collection.pack_image_url) embed.setImage(collection.pack_image_url);

  embed.setFooter({ text: "Las probabilidades están en /info" });
  return embed;
}

/**
 * Build a trade embed.
 */
function buildTradeEmbed(
  trade,
  senderUser,
  receiverUser,
  senderItems,
  receiverItems,
) {
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("🤝 Oferta de Intercambio")
    .addFields(
      {
        name: `${senderUser?.username || "Sender"} ofrece:`,
        value: senderItems.map((i) => i.name).join("\n") || "Nada",
        inline: true,
      },
      {
        name: `${receiverUser?.username || "Receiver"} ofrece:`,
        value: receiverItems.map((i) => i.name).join("\n") || "Nada",
        inline: true,
      },
    )
    .setFooter({ text: `Trade #${trade.id} | Estado: ${trade.status}` });
}

module.exports = {
  buildArtworkEmbed,
  buildProfileEmbed,
  buildPackEmbed,
  buildTradeEmbed,
};
