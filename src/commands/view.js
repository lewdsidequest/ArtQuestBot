const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const supabase = require("../database/supabase");
const artworkService = require("../services/artwork");
const { buildArtworkEmbed } = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("view")
    .setDescription(
      "Muestra la imagen e información detallada de una carta por su ID",
    )
    .addIntegerOption((opt) =>
      opt
        .setName("id")
        .setDescription(
          "El ID único de la carta (que aparece en tu inventario)",
        )
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const id = interaction.options.getInteger("id");

      // 🛠️ FILTRO: inner join y artworks.status = 'active'
      const { data: pa, error } = await supabase
        .from("player_artworks")
        .select(
          "*, artworks!inner(*, collections!artworks_collection_id_fkey(name)), players(username)",
        )
        .eq("id", id)
        .eq("artworks.status", "active")
        .single();

      if (error || !pa) {
        return interaction.editReply({
          content: `❌ No se encontró ninguna carta visible con el ID **${id}**.`,
        });
      }

      const embed = buildArtworkEmbed(pa.artworks, {
        playerArtwork: pa,
        ownerUsername: pa.players?.username || "Desconocido",
        collectionName: pa.artworks.collections?.name || "Desconocida",
        showVideoText: true, // Avisa del video
      });

      const isVideo =
        pa.artworks.image_url && pa.artworks.image_url.match(/\.(mp4|webm)$/i);
      const row = new ActionRowBuilder();

      if (isVideo) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId("view_play_video")
            .setLabel("Ver Video")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("▶️"),
        );
      }

      // Botón de reporte
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`view_report_${pa.artworks.id}`)
          .setLabel("Reportar")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🚨"),
      );

      const msg = await interaction.editReply({
        content: `🔍 **Inspeccionando carta con el ID ${id}**:`,
        embeds: [embed],
        components: [row],
      });

      // Quitamos el filtro estricto para que la comunidad pueda ayudar a reportar
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      collector.on("collect", async (i) => {
        if (i.customId === "view_play_video") {
          // protegemos la interacción del video para evitar spam en el chat
          if (i.user.id !== interaction.user.id) {
            return i.reply({
              content:
                "❌ Solo la persona que usó el comando puede reproducir el video aquí.",
              ephemeral: true,
            });
          }

          const rawVideoUrl = pa.artworks.image_url;
          const headerInfo = `🎥 **${pa.artworks.name} (ID: ${pa.id}) | ⭐${pa.stars} | Nv.${pa.level} | ${pa.artworks.rarity_id.name}**`;

          const updatedRow = new ActionRowBuilder();
          i.message.components[0].components.forEach((btn) => {
            if (btn.customId !== "view_play_video")
              updatedRow.addComponents(ButtonBuilder.from(btn));
          });

          await i.update({
            content: `${i.message.content}\n\n[${headerInfo}](${rawVideoUrl})`,
            embeds: [],
            components: updatedRow.components.length ? [updatedRow] : [],
          });
        }

        if (i.customId.startsWith("view_report_")) {
          await i.deferReply({ ephemeral: true });
          try {
            const artId = i.customId.split("view_report_")[1];
            // El ID que se envía ahora es el de la persona que hizo clic (i.user.id), no el del comando
            const rep = await artworkService.reportArtwork(artId, i.user.id);
            if (rep.hidden) {
              await i.editReply({
                content: "🚨 Artwork reportado. Ha sido ocultado globalmente.",
              });
            } else {
              await i.editReply({
                content: `🚨 Artwork reportado. (Reportes: ${rep.currentCount})`,
              });
            }
          } catch (err) {
            await i.editReply({ content: `❌ ${err.message}` });
          }
        }
      });

      collector.on("end", () =>
        interaction.editReply({ components: [] }).catch(() => {}),
      );
    } catch (err) {
      console.error("[View]", err);
      await interaction.editReply({ content: `Error: ${err.message}` });
    }
  },
};
