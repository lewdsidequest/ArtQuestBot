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
const ActionManager = require("../utils/ActionManager"); // Importamos el gestor anti-spam

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

      const art = pa.artworks;
      const isGif = art.is_gif ?? /\.(gif)$/i.test(art.image_url);
      const isVideo = art.is_video ?? /\.(mp4|webm)$/i.test(art.image_url);

      const embed = buildArtworkEmbed(art, {
        playerArtwork: pa,
        ownerUsername: pa.players?.username || "Desconocido",
        collectionName: art.collections?.name || "Desconocida",
        showVideoText: true,
      });

      // 🛠️ Ajuste de URL y aviso si es GIF animado
      if (isGif) {
        embed.setImage(art.image_url);
        embed.setFooter({
          text:
            (embed.data.footer?.text ? embed.data.footer.text + " | " : "") +
            "💡 Los GIFs pueden tardar en cargar",
        });
      }

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

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`view_report_${art.id}`)
          .setLabel("Reportar")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🚨"),
      );

      const msg = await interaction.editReply({
        content: `🔍 **Inspeccionando carta con el ID ${id}**:`,
        embeds: [embed],
        components: [row],
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      collector.on("collect", async (i) => {
        // 🛠️ Control de concurrencia y bloqueo de usuario
        if (!ActionManager.lockUser(i.user.id)) {
          return i.reply({
            content: "⏳ Procesando tu acción, por favor espera...",
            ephemeral: true,
          });
        }

        try {
          if (i.customId === "view_play_video") {
            if (i.user.id !== interaction.user.id) {
              return i.reply({
                content:
                  "❌ Solo la persona que usó el comando puede reproducir el video aquí.",
                ephemeral: true,
              });
            }

            await i.deferUpdate();
            const rawVideoUrl = art.image_url;
            const rarityData = require("../utils/rarity").get(art.rarity_id);
            const rarityName = rarityData ? rarityData.name : "";
            const headerInfo = `🎥 **${art.name} (ID: ${pa.id}) | ⭐${pa.stars} | Nv.${pa.level} | ${rarityName}**`;

            const updatedRow = new ActionRowBuilder();
            i.message.components[0].components.forEach((btn) => {
              if (btn.customId !== "view_play_video")
                updatedRow.addComponents(
                  ButtonBuilder.from(btn).setDisabled(true),
                );
            });

            await interaction.editReply({
              content: `${i.message.content}\n\n[${headerInfo}](${rawVideoUrl})`,
              embeds: [],
              components: updatedRow.components.length ? [updatedRow] : [],
            });
          }

          if (i.customId.startsWith("view_report_")) {
            await i.deferReply({ ephemeral: true });
            const artId = i.customId.split("view_report_")[1];
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
          }
        } finally {
          ActionManager.unlockUser(i.user.id);
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
