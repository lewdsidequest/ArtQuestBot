const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const supabase = require("../database/supabase");
const economy = require("../services/economy");
const RarityManager = require("../utils/rarity");
const ActionManager = require("../utils/ActionManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("evolve")
    .setDescription("Evoluciona una carta para aumentar su rareza")
    .addIntegerOption((opt) =>
      opt
        .setName("id")
        .setDescription("El ID de la carta en tu inventario a evolucionar")
        .setRequired(true)
        .setMinValue(1),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const playerId = interaction.user.id;
      const paId = interaction.options.getInteger("id");

      // 🛠️ CORRECCIÓN: Añadido 'rarity_id' a la consulta de artworks
      const { data: pa, error: paErr } = await supabase
        .from("player_artworks")
        .select("*, artworks(name, image_url, sample_url, is_gif, rarity_id)")
        .eq("id", paId)
        .eq("player_id", playerId)
        .single();

      if (paErr || !pa) {
        return interaction.editReply(
          "❌ Carta no encontrada en tu inventario.",
        );
      }

      // 🛠️ SALVAVIDAS: Verificación estricta de rareza
      const activeRarityId = pa.rarity_id || pa.artworks?.rarity_id;
      const currentRarity = RarityManager.get(activeRarityId);

      if (!currentRarity) {
        return interaction.editReply(
          "❌ Error: No se pudo determinar la rareza actual de esta carta.",
        );
      }

      const nextRarity = RarityManager.getNextRarity(currentRarity.id);

      if (!nextRarity) {
        return interaction.editReply(
          `❌ **${pa.artworks.name}** ya ha alcanzado la rareza máxima (**${currentRarity.name}**). ¡No puede evolucionar más!`,
        );
      }

      const { data: configData } = await supabase
        .from("global_configs")
        .select("value")
        .eq("key", "economy_costs")
        .single();

      const ecoConfig = configData?.value || {};
      const inkCosts = ecoConfig.evolve_ink_costs || [];
      const dustCosts = ecoConfig.evolve_dust_costs || [];

      const requiredInk = inkCosts[currentRarity.id] || 0;
      const requiredDust = dustCosts[currentRarity.id] || 0;

      const player = await economy.getPlayer(playerId);
      if (player.ink_dollars < requiredInk || player.star_dust < requiredDust) {
        return interaction.editReply(
          `❌ **Fondos Insuficientes para evolucionar a ${nextRarity.name}**.\n` +
            `Necesitas: **${requiredInk.toLocaleString()} Ink$** y **${requiredDust.toLocaleString()} Polvo**.\n` +
            `Tienes: **${player.ink_dollars.toLocaleString()} Ink$** y **${player.star_dust.toLocaleString()} Polvo**.`,
        );
      }

      // CÁLCULO DE REEMBOLSO
      const refundedInk = pa.invested_ink || 0;
      const refundedDust = pa.invested_dust || 0;
      const willReset = pa.level > 1 || pa.stars > 1;

      const isGif =
        pa.artworks.is_gif ?? /\.(gif)$/i.test(pa.artworks.image_url);
      const imageUrl = isGif
        ? pa.artworks.image_url
        : pa.artworks.sample_url || pa.artworks.image_url;

      const confirmEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("✨ Confirmar Evolución ✨")
        .setDescription(
          `¿Estás seguro de que deseas evolucionar **${pa.artworks.name}**?`,
        )
        .setThumbnail(imageUrl)
        .addFields(
          {
            name: "Mejora de Rareza",
            value: `${currentRarity.emoji} ${currentRarity.name} ➔ ${nextRarity.emoji} **${nextRarity.name}**`,
            inline: false,
          },
          {
            name: "Costo de Evolución",
            value: `💰 **-${requiredInk.toLocaleString()} Ink$**\n🌟 **-${requiredDust.toLocaleString()} Polvo**`,
            inline: true,
          },
        );

      if (willReset) {
        confirmEmbed.addFields({
          name: "⚠️ REINICIO DE ESTADÍSTICAS",
          value: `Al evolucionar, la carta volverá a **Nivel 1** y **1 Estrella**.\nSe te reembolsará la inversión anterior:\n💰 **+${refundedInk.toLocaleString()} Ink$**\n🌟 **+${refundedDust.toLocaleString()} Polvo**`,
          inline: false,
        });
        confirmEmbed.setColor(0xe74c3c);
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_evolve")
          .setLabel("Evolucionar")
          .setStyle(ButtonStyle.Success)
          .setEmoji("✨"),
        new ButtonBuilder()
          .setCustomId("cancel_evolve")
          .setLabel("Cancelar")
          .setStyle(ButtonStyle.Secondary),
      );

      const msg = await interaction.editReply({
        embeds: [confirmEmbed],
        components: [row],
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
        filter: (i) => i.user.id === interaction.user.id,
      });

      collector.on("collect", async (i) => {
        await i.deferUpdate();

        if (!ActionManager.lockUser(i.user.id)) {
          return i.followUp({
            content: "⏳ Procesando tu acción, espera...",
            ephemeral: true,
          });
        }

        try {
          const disabledRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(
              i.message.components[0].components[0],
            ).setDisabled(true),
            ButtonBuilder.from(
              i.message.components[0].components[1],
            ).setDisabled(true),
          );
          await interaction.editReply({ components: [disabledRow] });

          if (i.customId === "cancel_evolve") {
            const cancelEmbed = new EmbedBuilder()
              .setColor(0x95a5a6)
              .setDescription("🚫 Evolución cancelada.");
            await interaction.editReply({
              embeds: [cancelEmbed],
              components: [],
            });
            return collector.stop("cancelled");
          }

          if (i.customId === "confirm_evolve") {
            await economy.deductInk(playerId, requiredInk);
            await economy.addStarDust(playerId, -requiredDust);

            if (refundedInk > 0) await economy.addInk(playerId, refundedInk);
            if (refundedDust > 0)
              await economy.addStarDust(playerId, refundedDust);

            const { error: updErr } = await supabase
              .from("player_artworks")
              .update({
                rarity_id: nextRarity.id,
                level: 1,
                stars: 1,
                invested_ink: 0,
                invested_dust: 0,
              })
              .eq("id", paId);

            if (updErr)
              throw new Error("Fallo al actualizar la base de datos.");

            // 🛠️ TRACKERS DE MEDALLAS EN SEGUNDO PLANO
            economy
              .getPlayer(playerId)
              .then((updatedPlayer) => {
                if (updatedPlayer) {
                  const currentHighest =
                    updatedPlayer.highest_rarity_unlocked || 0;
                  const newHighest = Math.max(currentHighest, nextRarity.id);

                  supabase
                    .from("players")
                    .update({
                      total_cards_evolved:
                        (updatedPlayer.total_cards_evolved || 0) + 1,
                      highest_rarity_unlocked: newHighest,
                    })
                    .eq("id", playerId)
                    .then();
                }
              })
              .catch(() => {});

            const successEmbed = new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle("🎉 ¡Evolución Completada! 🎉")
              .setDescription(
                `**${pa.artworks.name}** ha evolucionado a rareza ${nextRarity.emoji} **${nextRarity.name}**.`,
              );

            await interaction.editReply({
              embeds: [successEmbed],
              components: [],
            });
            collector.stop("success");
          }
        } catch (error) {
          await interaction.editReply({
            content: `❌ Error: ${error.message}`,
            embeds: [],
            components: [],
          });
          collector.stop("error");
        } finally {
          ActionManager.unlockUser(i.user.id);
        }
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time")
          interaction.editReply({ components: [] }).catch(() => {});
      });
    } catch (err) {
      console.error("[Evolve]", err);
      await interaction.editReply(`❌ Error inesperado: ${err.message}`);
    }
  },
};
