const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const economy = require("../services/economy");
const artworkService = require("../services/artwork");
const packService = require("../services/pack");
const { buildPackEmbed, buildArtworkEmbed } = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pack")
    .setDescription("Abre un sobre de artworks")
    .addStringOption((opt) =>
      opt
        .setName("coleccion")
        .setDescription("Colección del sobre")
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const player = await economy.getOrCreatePlayer(
        interaction.user.id,
        interaction.user.username,
      );
      const collectionSlug = interaction.options.getString("coleccion");
      const collection =
        await artworkService.getCollectionWithConfigs(collectionSlug);

      if (!collection) {
        return interaction.editReply({
          content: "❌ Colección no encontrada.",
        });
      }

      const cost = packService.calculatePackCost(collection);

      if (player.ink_dollars < cost.final) {
        return interaction.editReply({
          content: `❌ Necesitas **${cost.final} Ink$**. Tienes **${player.ink_dollars} Ink$**.`,
        });
      }

      const embed = buildPackEmbed(collection, cost);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`pack_open_${collectionSlug}`)
          .setLabel("Abrir Sobre")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("📦"),
        new ButtonBuilder()
          .setCustomId("pack_cancel")
          .setLabel("Cancelar")
          .setStyle(ButtonStyle.Secondary),
      );

      let confirmText = `💳 **Cuesta:** ${cost.final} Ink$ | **Tu Saldo:** ${player.ink_dollars} Ink$`;

      const msg = await interaction.editReply({
        content: confirmText,
        embeds: [embed],
        components: [row],
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
        filter: (i) => i.user.id === interaction.user.id,
      });

      let isPackOpened = false;

      collector.on("collect", async (i) => {
        if (i.customId === "pack_cancel") {
          await i.update({
            content: "🚫 Sobre cancelado. No se te ha cobrado nada.",
            embeds: [],
            components: [],
          });
          collector.stop("cancelled");
          return;
        }

        if (i.customId === `pack_open_${collectionSlug}`) {
          isPackOpened = true;
          await i.deferUpdate();

          try {
            const result = await packService.openPack(
              interaction.user.id,
              collectionSlug,
              interaction.user.username,
            );

            const artworkEmbed = buildArtworkEmbed(result.artwork, {
              playerArtwork: result.playerArtwork,
              isNewGlobal: result.isNewGlobal,
              isNewPersonal: result.isNewPersonal,
              ownerUsername: interaction.user.username,
              collectionName: collection.name,
              showVideoText: true,
            });

            let content = "";
            if (result.isNewGlobal)
              content += "🌟 **¡Nuevo artwork descubierto globalmente!**\n";
            if (result.isNewPersonal)
              content += "🎉 **¡Primera vez que obtienes este artwork!**\n";
            if (result.isDuplicate)
              content +=
                "🔁 **¡Duplicado!** Se ha guardado una copia en tu inventario.\n";

            const btnKeepLabel = result.isDuplicate
              ? "Conservar Duplicado"
              : "Conservar Artwork";

            const actionRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`keep_art_${result.playerArtwork.id}`)
                .setLabel(btnKeepLabel)
                .setStyle(ButtonStyle.Success)
                .setEmoji("✅"),
              new ButtonBuilder()
                .setCustomId(`dust_art_${result.playerArtwork.id}`)
                .setLabel("Convertir a Polvo")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("♻️"),
            );

            const isVideo =
              result.artwork.image_url &&
              result.artwork.image_url.match(/\.(mp4|webm)$/i);
            if (isVideo) {
              actionRow.addComponents(
                new ButtonBuilder()
                  .setCustomId(`pack_video_${result.artwork.id}`)
                  .setLabel("Ver Video")
                  .setStyle(ButtonStyle.Primary)
                  .setEmoji("▶️"),
              );
            }

            actionRow.addComponents(
              new ButtonBuilder()
                .setCustomId(`report_art_${result.artwork.id}`)
                .setLabel("Reportar")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("🚨"),
            );

            await i.editReply({
              content: content || "\u200B",
              embeds: [artworkEmbed],
              components: [actionRow],
            });
          } catch (err) {
            await i.editReply({
              content: `😵‍💫💫 Error al abrir: ${err.message}`,
              embeds: [],
              components: [],
            });
            collector.stop("error");
          }
          return;
        }

        // --- BOTÓN VER VIDEO ---
        if (i.customId.startsWith("pack_video_")) {
          const rawVideoUrl = i.message.embeds[0].url;
          const cardName = i.message.embeds[0].title;
          const headerInfo = `🎥 **${cardName}**`;

          const updatedRow = new ActionRowBuilder();
          i.message.components[0].components.forEach((btn) => {
            const newBtn = ButtonBuilder.from(btn);
            if (btn.customId === i.customId) newBtn.setDisabled(true);
            updatedRow.addComponents(newBtn);
          });

          await i.update({
            content: `${i.message.content}\n\n[${headerInfo}](${rawVideoUrl})`,
            embeds: [],
            components: [updatedRow],
          });
          return;
        }

        // --- BOTÓN CONSERVAR ---
        if (i.customId.startsWith("keep_art_")) {
          await i.deferUpdate();
          await i.editReply({
            content:
              i.message.content +
              "\n✅ **¡Artwork guardado exitosamente en tu inventario!**",
            components: [],
          });
          collector.stop("action_taken");
          return;
        }

        // --- BOTÓN CONVERTIR A POLVO ---
        if (i.customId.startsWith("dust_art_")) {
          await i.deferUpdate();
          try {
            const paId = i.customId.split("dust_art_")[1];
            const res = await packService.convertToDust(
              interaction.user.id,
              paId,
            );

            await i.editReply({
              content:
                i.message.content +
                `\n✨ **¡Carta convertida a polvo!** Obtuviste +**${res.dustReward} Polvos de Estrella🌟**`,
              components: [],
            });
          } catch (err) {
            await i.editReply({
              content: `❌ Error: ${err.message}`,
              components: [],
            });
          }
          collector.stop("action_taken");
          return;
        }

        // --- BOTÓN REPORTAR ---
        if (i.customId.startsWith("report_art_")) {
          await i.deferReply({ ephemeral: true });
          try {
            const artId = i.customId.split("report_art_")[1];
            const rep = await artworkService.reportArtwork(
              artId,
              interaction.user.id,
            );
            if (rep.hidden) {
              await i.editReply({
                content:
                  "🚨 Artwork reportado. Ha alcanzado el límite de seguridad y **ha sido ocultado globalmente**.",
              });
            } else {
              await i.editReply({
                content: `🚨 Artwork reportado. (Reportes: ${rep.currentCount})`,
              });
            }
          } catch (err) {
            await i.editReply({ content: `❌ ${err.message}` });
          }
          return;
        }
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time") {
          try {
            if (isPackOpened) {
              await interaction.editReply({
                content:
                  msg.content +
                  "\n*(Tiempo agotado - El artwork se ha guardado automáticamente en tu inventario)*",
                components: [],
              });
            } else {
              await interaction.editReply({
                content:
                  "*(Tiempo agotado - El sobre no fue abierto y no se te ha cobrado nada)*",
                embeds: [],
                components: [],
              });
            }
          } catch (e) {}
        }
      });
    } catch (err) {
      console.error("[Pack]", err);
      await interaction.editReply({ content: `Error: ${err.message}` });
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const collections = await artworkService.getDailyStore();

    const filtered = collections
      .filter((c) => {
        const query = focused.toLowerCase();
        const matchesName = c.name.toLowerCase().includes(query);
        const matchesSlug = c.slug.toLowerCase().includes(query);
        const matchesTags = c.content_tags
          ? c.content_tags.toLowerCase().includes(query)
          : false;
        return matchesName || matchesSlug || matchesTags;
      })
      // ORDENAMIENTO POR PRECIO: De menor a mayor
      .sort((a, b) => {
        const costA = packService.calculatePackCost(a).final;
        const costB = packService.calculatePackCost(b).final;
        return costA - costB;
      })
      .slice(0, 25);

    await interaction.respond(
      filtered.map((c) => {
        const cost = packService.calculatePackCost(c);
        const discountTag = cost.discount > 0 ? ` [🔥 -${cost.discount}%]` : "";

        let baseText = `${c.name} (${cost.final.toLocaleString()} Ink$)${discountTag}`;
        if (c.content_tags) {
          baseText += ` | ${c.content_tags}`;
        }

        let displayName = baseText;
        if (displayName.length > 100) {
          displayName = displayName.substring(0, 97) + "...";
        }

        return { name: displayName, value: c.slug };
      }),
    );
  },
};
