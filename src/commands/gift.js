const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const economy = require("../services/economy");
const giftService = require("../services/gift");
const { formatCardText } = require("../utils/cardFormat");
const ActionManager = require("../utils/ActionManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gift")
    .setDescription("Regala una carta de tu inventario")
    .addSubcommand((sub) =>
      sub
        .setName("user")
        .setDescription("Regala una carta a un usuario específico")
        .addIntegerOption((opt) =>
          opt
            .setName("carta")
            .setDescription("ID de la carta a regalar")
            .setRequired(true),
        )
        .addUserOption((opt) =>
          opt
            .setName("destino")
            .setDescription("Usuario que recibirá el regalo")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("giveaway")
        .setDescription(
          "Lanza un regalo al chat. ¡El primero en pulsar el botón se lo lleva!",
        )
        .addIntegerOption((opt) =>
          opt
            .setName("carta")
            .setDescription("ID de la carta a regalar")
            .setRequired(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cartaId = interaction.options.getInteger("carta");
    const senderId = interaction.user.id;

    await interaction.deferReply();

    try {
      // 1. Verificamos que el remitente tenga cuenta y la carta cumpla los requisitos
      await economy.getOrCreatePlayer(senderId, interaction.user.displayName);
      const { pa, today, dailySent, config } =
        await giftService.checkEligibility(senderId, cartaId);

      const cardDesc = formatCardText(pa, "detailed");
      const isGif =
        pa.artworks.is_gif ?? /\.(gif)$/i.test(pa.artworks.image_url);
      const imageUrl = isGif
        ? pa.artworks.image_url
        : pa.artworks.sample_url || pa.artworks.image_url;

      // ==========================================
      // FASE DE CONFIRMACIÓN (AMBOS MODOS)
      // ==========================================
      const confirmEmbed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("⚠️ Confirmar Envío de Regalo")
        .setDescription(
          `Estás a punto de regalar esta carta. ¡Revisa bien antes de confirmar!\n\n${cardDesc}`,
        )
        .setThumbnail(imageUrl);

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_send_gift")
          .setLabel("Confirmar Envío")
          .setStyle(ButtonStyle.Success)
          .setEmoji("✅"),
        new ButtonBuilder()
          .setCustomId("cancel_send_gift")
          .setLabel("Cancelar")
          .setStyle(ButtonStyle.Secondary),
      );

      const confirmMsg = await interaction.editReply({
        embeds: [confirmEmbed],
        components: [confirmRow],
      });

      try {
        const confirmInteraction = await confirmMsg.awaitMessageComponent({
          filter: (i) => i.user.id === senderId,
          time: 60000,
        });

        if (confirmInteraction.customId === "cancel_send_gift") {
          const cancelEmbed = new EmbedBuilder()
            .setColor(0x95a5a6)
            .setDescription("🚫 Envío de regalo cancelado.");
          await confirmInteraction.update({
            embeds: [cancelEmbed],
            components: [],
          });
          return;
        }

        await confirmInteraction.deferUpdate();
      } catch (e) {
        const timeoutEmbed = new EmbedBuilder()
          .setColor(0x95a5a6)
          .setDescription(
            "⏳ Tiempo de confirmación agotado. Regalo cancelado.",
          );
        await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
        return;
      }

      // Si llegamos aquí, el usuario confirmó el envío. Continuamos con la lógica pública.

      // ==========================================
      // REGALO A USUARIO ESPECÍFICO
      // ==========================================
      if (sub === "user") {
        const targetUser = interaction.options.getUser("destino");

        if (targetUser.bot)
          return interaction.editReply({
            content: "❌ No puedes regalarle cartas a los bots.",
            embeds: [],
            components: [],
          });
        if (targetUser.id === senderId)
          return interaction.editReply({
            content: "❌ No puedes regalarte cartas a ti mismo.",
            embeds: [],
            components: [],
          });

        await economy.getOrCreatePlayer(targetUser.id, targetUser.displayName);

        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle("🎁 ¡TIENES UN REGALO!")
          .setDescription(
            `¡Hola ${targetUser}! **${interaction.member?.displayName || interaction.user.displayName}** te quiere regalar esta carta:\n\n${cardDesc}`,
          )
          .setImage(imageUrl)
          .setFooter({
            text: `A ${interaction.member?.displayName || interaction.user.displayName} le quedan ${config.max_daily - dailySent - 1} regalos hoy`,
          });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("gift_accept")
            .setLabel("Aceptar Regalo")
            .setStyle(ButtonStyle.Success)
            .setEmoji("🎉"),
          new ButtonBuilder()
            .setCustomId("gift_decline")
            .setLabel("Rechazar")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("gift_cancel_sender")
            .setLabel("Cancelar (Remitente)")
            .setStyle(ButtonStyle.Secondary),
        );

        const msg = await interaction.editReply({
          content: `${targetUser}`,
          embeds: [embed],
          components: [row],
        });

        // Permitimos interactuar tanto al remitente como al destinatario
        const collector = msg.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 300000, // 5 minutos para responder
        });

        collector.on("collect", async (i) => {
          // --- ACCIONES DEL REMITENTE ---
          if (i.customId === "gift_cancel_sender") {
            if (i.user.id !== senderId) {
              return i.reply({
                content: "❌ Solo el que envió el regalo puede cancelarlo.",
                flags: MessageFlags.Ephemeral,
              });
            }

            await i.deferUpdate();
            const cancelEmbed = new EmbedBuilder()
              .setColor(0xe74c3c)
              .setDescription(
                `🚫 El regalo fue cancelado por el remitente (**${interaction.member?.displayName || interaction.user.displayName}**).`,
              );
            await interaction.editReply({
              content: "",
              embeds: [cancelEmbed],
              components: [],
            });
            return collector.stop();
          }

          // --- ACCIONES DEL DESTINATARIO ---
          if (i.user.id !== targetUser.id) {
            return i.reply({
              content: "❌ ¡Este regalo no es para ti!",
              flags: MessageFlags.Ephemeral,
            });
          }

          if (!ActionManager.lockUser(targetUser.id)) {
            return i.reply({
              content: "⏳ Procesando respuesta...",
              flags: MessageFlags.Ephemeral,
            });
          }

          try {
            await i.deferUpdate();

            const disabledRow = new ActionRowBuilder().addComponents(
              ButtonBuilder.from(
                i.message.components[0].components[0],
              ).setDisabled(true),
              ButtonBuilder.from(
                i.message.components[0].components[1],
              ).setDisabled(true),
              ButtonBuilder.from(
                i.message.components[0].components[2],
              ).setDisabled(true),
            );
            await interaction.editReply({ components: [disabledRow] });

            if (i.customId === "gift_decline") {
              const declineEmbed = new EmbedBuilder()
                .setColor(0x95a5a6)
                .setDescription(
                  `🚫 **${targetUser.displayName}** ha rechazado el regalo.`,
                );
              await interaction.editReply({
                content: "",
                embeds: [declineEmbed],
                components: [],
              });
              return collector.stop();
            }

            if (i.customId === "gift_accept") {
              await giftService.executeGift(
                senderId,
                targetUser.id,
                cartaId,
                today,
                dailySent,
              );
              const successEmbed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle("✅ ¡Regalo Completado!")
                .setDescription(
                  `**${targetUser.displayName}** ha aceptado el regalo de **${interaction.member?.displayName || interaction.user.displayName}**.\n\n${cardDesc}`,
                );

              await interaction.editReply({
                content: "",
                embeds: [successEmbed],
                components: [],
              });
              collector.stop();
            }
          } catch (error) {
            await interaction.editReply({
              content: `❌ Fallo en el regalo: ${error.message}`,
              embeds: [],
              components: [],
            });
            collector.stop();
          } finally {
            ActionManager.unlockUser(targetUser.id);
          }
        });

        collector.on("end", async (collected, reason) => {
          if (reason === "time") {
            const timeoutEmbed = new EmbedBuilder()
              .setColor(0xe74c3c)
              .setDescription(
                "⏳ El regalo ha expirado por falta de respuesta.",
              );
            await interaction
              .editReply({
                content: "",
                embeds: [timeoutEmbed],
                components: [],
              })
              .catch(() => {});
          }
        });
      }

      // ==========================================
      // REGALO GLOBAL (GIVEAWAY)
      // ==========================================
      if (sub === "giveaway") {
        const embed = new EmbedBuilder()
          .setColor(0xe67e22)
          .setTitle("🎉 ¡REGALO SALVAJE (GIVEAWAY)!")
          .setDescription(
            `**${interaction.member?.displayName || interaction.user.displayName}** ha lanzado una carta. ¡El primero en reclamarla se la queda!\n\n${cardDesc}`,
          )
          .setImage(imageUrl)
          .setFooter({
            text: `A ${interaction.member?.displayName || interaction.user.displayName} le quedan ${config.max_daily - dailySent - 1} regalos hoy`,
          });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("giveaway_claim")
            .setLabel("¡Reclamar!")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("🎁"),
          new ButtonBuilder()
            .setCustomId("giveaway_cancel_sender")
            .setLabel("Cancelar (Remitente)")
            .setStyle(ButtonStyle.Secondary),
        );

        const msg = await interaction.editReply({
          content: "",
          embeds: [embed],
          components: [row],
        });

        const collector = msg.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 60000,
        });

        collector.on("collect", async (i) => {
          // --- ACCIONES DEL REMITENTE ---
          if (i.customId === "giveaway_cancel_sender") {
            if (i.user.id !== senderId) {
              return i.reply({
                content: "❌ Solo el que envió el giveaway puede cancelarlo.",
                flags: MessageFlags.Ephemeral,
              });
            }

            await i.deferUpdate();
            const cancelEmbed = new EmbedBuilder()
              .setColor(0xe74c3c)
              .setDescription(
                `🚫 El giveaway fue cancelado por el remitente (**${interaction.member?.displayName || interaction.user.displayName}**).`,
              );
            await interaction.editReply({
              embeds: [cancelEmbed],
              components: [],
            });
            return collector.stop();
          }

          // --- ACCIÓN DE RECLAMAR (OTROS USUARIOS) ---
          const claimerId = i.user.id;

          if (claimerId === senderId) {
            return i.reply({
              content: "❌ No puedes reclamar tu propio giveaway.",
              flags: MessageFlags.Ephemeral,
            });
          }

          if (!ActionManager.lockUser(claimerId)) {
            return i.reply({
              content: "⏳ Procesando reclamo...",
              flags: MessageFlags.Ephemeral,
            });
          }

          try {
            await i.deferUpdate();

            await economy.getOrCreatePlayer(claimerId, i.user.username);
            await giftService.executeGift(
              senderId,
              claimerId,
              cartaId,
              today,
              dailySent,
            );

            const successEmbed = new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle("🎊 ¡Giveaway Reclamado!")
              .setDescription(
                `¡Felicidades a **${i.user.username}**! Logró atrapar el regalo de **${interaction.member?.displayName || interaction.user.displayName}**.\n\n${cardDesc}`,
              );

            await interaction.editReply({
              embeds: [successEmbed],
              components: [],
            });
            collector.stop();
          } catch (error) {
            await i.followUp({
              content: `❌ No pudiste reclamarlo: ${error.message}`,
              flags: MessageFlags.Ephemeral,
            });
          } finally {
            ActionManager.unlockUser(claimerId);
          }
        });

        collector.on("end", async (collected, reason) => {
          if (reason === "time") {
            const timeoutEmbed = new EmbedBuilder()
              .setColor(0x95a5a6)
              .setDescription(
                `💨 Nadie reclamó el giveaway de **${interaction.member?.displayName || interaction.user.displayName}**. La carta regresó a su inventario.`,
              );
            await interaction
              .editReply({ embeds: [timeoutEmbed], components: [] })
              .catch(() => {});
          }
        });
      }
    } catch (err) {
      console.error("[Gift]", err);
      // Solo lanzamos editReply si no hemos superado la fase de awaitMessageComponent que podría haber borrado todo
      await interaction
        .editReply({
          content: `❌ Error: ${err.message}`,
          components: [],
          embeds: [],
        })
        .catch(() => {});
    }
  },
};
