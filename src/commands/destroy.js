const supabase = require("../database/supabase");
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const economy = require("../services/economy");
const packService = require("../services/pack");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("destroy")
    .setDescription(
      "Destruye artworks para obtener Polvo de Estrella y recuperar Ink$ invertidos",
    )
    .addSubcommand((sub) =>
      sub
        .setName("carta")
        .setDescription("Destruye una carta específica por su ID")
        .addIntegerOption((opt) =>
          opt
            .setName("id")
            .setDescription("ID del artwork en tu inventario")
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("duplicados")
        .setDescription(
          "Destruye TODOS tus duplicados de Nivel 1 y Estrella 1 simultáneamente",
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("nuke")
        .setDescription(
          "Destruye TODAS tus cartas excepto Favoritas, Amadas y tus Top Generadoras",
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const player = await economy.getOrCreatePlayer(
        interaction.user.id,
        interaction.user.username,
      );
      const sub = interaction.options.getSubcommand();

      // ==========================================
      // DESTRUCCIÓN INDIVIDUAL
      // ==========================================
      if (sub === "carta") {
        const paId = interaction.options.getInteger("id");
        try {
          // Primero, obtenemos la información de la carta sin destruirla
          const { data: pa, error: paErr } = await supabase
            .from("player_artworks")
            .select("*, artworks(*)")
            .eq("id", paId)
            .eq("player_id", interaction.user.id)
            .single();

          if (paErr || !pa) {
            return interaction.editReply({
              content:
                "❌ No posees ninguna carta con este ID o el ID es incorrecto.",
            });
          }
          if (pa.is_loved) {
            return interaction.editReply({
              content: "❌ No puedes destruir tu Carta Amada.",
            });
          }

          // Simulamos el reembolso para mostrarlo
          const { data: configData } = await supabase
            .from("global_configs")
            .select("value")
            .eq("key", "economy_costs")
            .maybeSingle();
          const ecoConfig = configData?.value || null;
          const { calculateRefund } = require("../utils/power");
          const refund = calculateRefund(
            pa.invested_ink,
            pa.invested_dust,
            pa.artworks.rarity_id,
            ecoConfig,
          );

          // Obtenemos nombre y emoji de la rareza
          const RarityManager = require("../utils/rarity");
          const rarityData = RarityManager.get(pa.artworks.rarity_id);
          const rarityDisplay = rarityData
            ? `${rarityData.name} ${rarityData.emoji || ""}`
            : "Unknown";

          const confirmEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("⚠️ Confirmar Destrucción")
            .setDescription(
              `Estás a punto de convertir **${pa.artworks.name}** en polvo.\n*(Esta acción no se puede deshacer)*`,
            )
            .setThumbnail(pa.artworks.sample_url || pa.artworks.image_url) // Usamos la miniatura o la imagen completa si no hay sample
            .addFields(
              {
                name: "Estadísticas de Carta",
                value: `Nivel: **${pa.level}**\nEstrellas: **${pa.stars}**\nPrestigio: **💠${pa.prestige_level || 0}**\nRareza: **${rarityDisplay}**`,
                inline: false,
              },
              {
                name: "✨ Polvo a Obtener",
                value: `+**${refund.refundedDust.toLocaleString()}**`,
                inline: true,
              },
              {
                name: "💰 Ink$ a Recuperar",
                value: `+**${refund.refundedInk.toLocaleString()}**`,
                inline: true,
              },
            );

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("confirm_single_destroy")
              .setLabel("Destruir Carta")
              .setStyle(ButtonStyle.Danger)
              .setEmoji("🔥"),
            new ButtonBuilder()
              .setCustomId("cancel_single_destroy")
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
            if (i.customId === "cancel_single_destroy") {
              const cancelEmbed = new EmbedBuilder()
                .setColor(0x95a5a6)
                .setTitle("🚫 Operación Cancelada")
                .setDescription("Tu carta está a salvo.");
              await i.update({ embeds: [cancelEmbed], components: [] });
              collector.stop("cancelled");
              return;
            }

            if (i.customId === "confirm_single_destroy") {
              await i.deferUpdate();
              try {
                // Ahora sí ejecutamos la destrucción real
                const result = await packService.convertToDust(
                  interaction.user.id,
                  paId,
                );

                const successEmbed = new EmbedBuilder()
                  .setColor(0x2ecc71)
                  .setTitle("♻️ Artwork Destruido")
                  .setDescription(
                    `Destruiste **${pa.artworks.name}** con éxito.`,
                  )
                  .addFields(
                    {
                      name: "✨ Polvo Recuperado",
                      value: `+**${result.dustReward.toLocaleString()}**`,
                      inline: true,
                    },
                    {
                      name: "💰 Ink$ Recuperado",
                      value: `+**${result.inkReward.toLocaleString()}**`,
                      inline: true,
                    },
                  );

                await interaction.editReply({
                  embeds: [successEmbed],
                  components: [],
                });
                collector.stop("success");
              } catch (error) {
                await interaction.editReply({
                  content: `❌ Error: ${error.message}`,
                  embeds: [],
                  components: [],
                });
                collector.stop("error");
              }
            }
          });

          collector.on("end", async (collected, reason) => {
            if (reason === "time")
              interaction.editReply({ components: [] }).catch(() => {});
          });

          return;
        } catch (e) {
          return interaction.editReply({ content: `❌ ${e.message}` });
        }
      }

      // ==========================================
      // DESTRUCCIÓN DE DUPLICADOS
      // ==========================================
      if (sub === "duplicados") {
        const { toDestroy, totalDust, totalInk, hasHighRarity, count } =
          await packService.getDestructibleDuplicates(interaction.user.id);

        if (count === 0) {
          return interaction.editReply({
            content:
              "❌ No tienes cartas duplicadas de Nivel 1 y Estrella 1 para destruir.\n*(Las copias con niveles/estrellas superiores o marcadas como 'Amada' están protegidas).*",
          });
        }

        const confirmEmbed = new EmbedBuilder()
          .setColor(0xf39c12)
          .setTitle("⚠️ Confirmar Destrucción de Duplicados")
          .setDescription(
            `Estás a punto de destruir **${count} cartas duplicadas**.\nSe mantendrá intacta la mejor copia de cada carta.`,
          )
          .addFields(
            {
              name: "✨ Polvo Estimado",
              value: `+**${totalDust.toLocaleString()}**`,
              inline: true,
            },
            {
              name: "💰 Ink$ Estimado",
              value: `+**${totalInk.toLocaleString()}**`,
              inline: true,
            },
          );

        if (hasHighRarity) {
          confirmEmbed.addFields({
            name: "🚨 ADVERTENCIA IMPORTANTE",
            value:
              "Este lote incluye copias duplicadas de rareza **Legendaria** o **Celestial**.",
            inline: false,
          });
          confirmEmbed.setColor(0xe74c3c);
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("confirm_mass_destroy")
            .setLabel("Destruir Duplicados")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("💥"),
          new ButtonBuilder()
            .setCustomId("cancel_mass_destroy")
            .setLabel("Cancelar")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("✖️"),
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
          if (i.customId === "cancel_mass_destroy") {
            const cancelEmbed = new EmbedBuilder()
              .setColor(0x95a5a6)
              .setTitle("🚫 Operación Cancelada")
              .setDescription("Tus duplicados están a salvo.");
            await i.update({ embeds: [cancelEmbed], components: [] });
            collector.stop("cancelled");
            return;
          }

          if (i.customId === "confirm_mass_destroy") {
            await i.deferUpdate();
            try {
              const result = await packService.executeMassDestroy(
                interaction.user.id,
                toDestroy,
                totalDust,
                totalInk,
              );
              const successEmbed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle("♻️ Limpieza Completada")
                .setDescription(
                  `Has destruido exitosamente **${count}** duplicados.`,
                )
                .addFields(
                  {
                    name: "✨ Nuevo Balance de Polvo",
                    value: `${result.newDust.toLocaleString()}`,
                    inline: true,
                  },
                  {
                    name: "💰 Ink$ Reembolsados",
                    value: `+${totalInk.toLocaleString()}`,
                    inline: true,
                  },
                );

              await interaction.editReply({
                embeds: [successEmbed],
                components: [],
              });
              collector.stop("success");
            } catch (error) {
              await interaction.editReply({
                content: `❌ Error durante la limpieza: ${error.message}`,
                embeds: [],
                components: [],
              });
              collector.stop("error");
            }
          }
        });

        collector.on("end", async (collected, reason) => {
          if (reason === "time")
            interaction.editReply({ components: [] }).catch(() => {});
        });
        return;
      }

      // ==========================================
      // DESTRUCCIÓN TOTAL (BOTÓN NUCLEAR)
      // ==========================================
      if (sub === "nuke") {
        const { toDestroy, totalDust, totalInk, hasHighRarity, count } =
          await packService.getDestructibleAll(interaction.user.id);

        if (count === 0) {
          return interaction.editReply({
            content:
              "❌ No tienes cartas elegibles para destruir.\n*(Todas tus cartas actuales están protegidas por ser Favoritas, Amadas o estar entre tus mejores Generadoras de Ink$).*",
          });
        }

        const confirmEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("☢️ ADVERTENCIA: PURGA DEL INVENTARIO")
          .setDescription(
            `Estás a punto de destruir **${count} cartas** de tu inventario.\n\n🛡️ **Cartas Protegidas:** Solamente se salvarán las cartas marcadas como 💖 **Amada**, 💎 **Favorito**, y tus **${player.generator_limit} Mejores Cartas Generadoras** de ingresos.`,
          )
          .addFields(
            {
              name: "✨ Polvo de Estrella Recuperado",
              value: `+**${totalDust.toLocaleString()}**`,
              inline: true,
            },
            {
              name: "💰 Ink Dollars Reembolsados",
              value: `+**${totalInk.toLocaleString()}**`,
              inline: true,
            },
          );

        if (hasHighRarity) {
          confirmEmbed.addFields({
            name: "🚨 ALERTA DE RAREZA ALTA",
            value:
              "¡Se destruirán cartas de rareza **Legendaria** o **Celestial** que no estén protegidas!",
            inline: false,
          });
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("confirm_all_destroy")
            .setLabel("Entendido, Destruir Todo")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("☢️"),
          new ButtonBuilder()
            .setCustomId("cancel_all_destroy")
            .setLabel("Cancelar")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("✖️"),
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
          if (i.customId === "cancel_all_destroy") {
            const cancelEmbed = new EmbedBuilder()
              .setColor(0x95a5a6)
              .setTitle("🚫 Operación Cancelada")
              .setDescription("Tu inventario permanece intacto.");
            await i.update({ embeds: [cancelEmbed], components: [] });
            collector.stop("cancelled");
            return;
          }

          if (i.customId === "confirm_all_destroy") {
            await i.deferUpdate();
            try {
              const result = await packService.executeMassDestroy(
                interaction.user.id,
                toDestroy,
                totalDust,
                totalInk,
              );
              const successEmbed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle("💥 Inventario Purgado Exitosamente")
                .setDescription(
                  `Se han convertido **${count}** cartas a recursos.`,
                )
                .addFields(
                  {
                    name: "✨ Nuevo Balance de Polvo",
                    value: `${result.newDust.toLocaleString()}`,
                    inline: true,
                  },
                  {
                    name: "💰 Ink$ Reembolsados",
                    value: `+${totalInk.toLocaleString()}`,
                    inline: true,
                  },
                );

              await interaction.editReply({
                embeds: [successEmbed],
                components: [],
              });
              collector.stop("success");
            } catch (error) {
              await interaction.editReply({
                content: `❌ Error durante la purga: ${error.message}`,
                embeds: [],
                components: [],
              });
              collector.stop("error");
            }
          }
        });

        collector.on("end", async (collected, reason) => {
          if (reason === "time")
            interaction.editReply({ components: [] }).catch(() => {});
        });
      }
    } catch (err) {
      console.error("[Destroy]", err);
      await interaction.editReply({
        content: `❌ Error inesperado: ${err.message}`,
      });
    }
  },
};
