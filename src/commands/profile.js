const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const economy = require("../services/economy");
const supabase = require("../database/supabase");
const RarityManager = require("../utils/rarity");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Muestra tu perfil y estadísticas")
    .addUserOption((opt) =>
      opt
        .setName("usuario")
        .setDescription("Ver perfil de otro jugador")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const target = interaction.options.getUser("usuario") || interaction.user;
      const targetMember =
        interaction.options.getMember("usuario") || interaction.member;
      const targetName = targetMember?.displayName || target.displayName;

      const player = await economy.getPlayer(target.id);

      if (!player) {
        await interaction.editReply({
          content:
            target.id === interaction.user.id
              ? "❌ Aún no estás registrado. Usa `/pack` o `/daily` para empezar."
              : "❌ Ese usuario no está registrado en el sistema.",
        });
        return;
      }

      // 1. Obtener Economía y Generadores
      const inkRate = await economy.getInkRate(target.id);
      const topGenerators = await economy.getTopGeneratorsDetails(target.id);
      const activeGeneratorsCount = topGenerators.length;

      // 2. Buscar Carta Destacada (Amada -> Top Generadora -> Nivel más alto)
      let bestCard = null;
      const { data: lovedCard } = await supabase
        .from("player_artworks")
        .select("*, artworks(name, image_url, sample_url, is_gif, rarity_id)")
        .eq("player_id", target.id)
        .eq("is_loved", true)
        .maybeSingle();

      if (lovedCard) {
        bestCard = lovedCard;
      } else if (topGenerators.length > 0) {
        bestCard = topGenerators[0];
      } else {
        const { data: topCardData } = await supabase
          .from("player_artworks")
          .select("*, artworks(name, image_url, sample_url, is_gif, rarity_id)")
          .eq("player_id", target.id)
          .order("level", { ascending: false })
          .order("stars", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (topCardData) bestCard = topCardData;
      }

      // 3. Construir la Vitrina de Logros (Solo medallas RECLAMADAS)
      const { data: rawMedals } = await supabase
        .from("player_medals")
        .select("medals(name, icon, tier)")
        .eq("player_id", target.id)
        .eq("is_claimed", true);

      let vitrinaText = "*Ningún logro desbloqueado aún.*";
      if (rawMedals && rawMedals.length > 0) {
        // Extraemos, ordenamos por Tier (las más difíciles primero) y limitamos a 12
        const sortedMedals = rawMedals
          .map((m) => m.medals)
          .sort((a, b) => b.tier - a.tier);

        const displayedMedals = sortedMedals.slice(0, 12);
        vitrinaText = displayedMedals.map((m) => m.icon).join(" ");

        // Si tiene más de 12 medallas reclamadas, mostramos un indicador discreto
        if (sortedMedals.length > 12) {
          vitrinaText += ` *(+${sortedMedals.length - 12})*`;
        }
      }

      // 4. Construir el Embed Principal (Clean & Minimalist)
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setAuthor({
          name: `Perfil de ${targetName}`,
          iconURL: target.displayAvatarURL({ dynamic: true }),
        })
        .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }));

      // Bloque 1: Estadísticas Core
      let desc = `💳 **Billetera:** ${player.ink_dollars.toLocaleString()} Ink$ | 🌟 ${player.star_dust.toLocaleString()} Polvo\n`;
      desc += `📈 **Producción:** ${inkRate.toLocaleString()} Ink$/h \`(${activeGeneratorsCount}/${player.generator_limit || 3} Slots)\`\n`;

      const packsOpened =
        player.lifetime_packs_opened || player.total_packs || 0;
      if (packsOpened > 0) {
        desc += `📦 **Sobres Abiertos:** ${packsOpened.toLocaleString()}\n`;
      }

      // Bloque 2: La Vitrina
      desc += `\n**🎖️ Vitrina de Logros:**\n> ${vitrinaText}\n\n`;

      // Bloque 3: Carta Destacada y su Imagen
      if (bestCard) {
        const art = bestCard.artworks;
        const rarityId = bestCard.rarity_id || art.rarity_id;
        const rarityData = RarityManager.get(rarityId);

        const rEmoji = rarityData ? rarityData.emoji : "✨";
        const rName = rarityData ? rarityData.name : "Desconocida";

        const isGif = art.is_gif ?? /\.(gif)$/i.test(art.image_url);
        const imgUrl = isGif ? art.image_url : art.sample_url || art.image_url;

        let cardLabel = bestCard.is_loved ? "💖 Carta Amada" : "⭐ Mejor Carta";

        desc += `**${cardLabel}:**\n${rEmoji} **${art.name}** \`(${rName})\`\nNivel: \`${bestCard.level}\` | Estrellas: \`${bestCard.stars}/10\``;

        embed.setImage(imgUrl);
      } else {
        desc += `*El inventario de este jugador está vacío.*`;
      }

      embed.setDescription(desc);

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("[Profile]", err);
      await interaction.editReply({
        content: `❌ Error al cargar el perfil: ${err.message}`,
      });
    }
  },
};
