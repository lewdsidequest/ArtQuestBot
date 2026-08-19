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
const tradeService = require("../services/trade");
const { formatCardText } = require("../utils/cardFormat");
const ActionManager = require("../utils/ActionManager"); // 🛠️ GESTOR ANTI-SPAM

module.exports = {
  data: new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Ofrece un intercambio directo de 1 carta por 1 carta.")
    .addIntegerOption((opt) =>
      opt
        .setName("mi_carta")
        .setDescription("El ID de la carta que TÚ ofreces")
        .setRequired(true),
    )
    .addUserOption((opt) =>
      opt
        .setName("usuario")
        .setDescription("El jugador al que le envías la oferta")
        .setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("su_carta")
        .setDescription("El ID de la carta que QUIERES de ese jugador")
        .setRequired(true),
    ),

  async execute(interaction) {
    const miCartaId = interaction.options.getInteger("mi_carta");
    const targetUser = interaction.options.getUser("usuario");
    const suCartaId = interaction.options.getInteger("su_carta");

    if (targetUser.bot) {
      return interaction.reply({
        content: "❌ No puedes intercambiar con bots.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      await economy.getOrCreatePlayer(
        interaction.user.id,
        interaction.user.username,
      );
      await economy.getOrCreatePlayer(targetUser.id, targetUser.username);

      const { trade, senderCard, receiverCard } =
        await tradeService.initiate1v1Trade(
          interaction.user.id,
          targetUser.id,
          miCartaId,
          suCartaId,
        );

      const embedColor = 0x9b59b6;
      const senderDesc = formatCardText(senderCard, "detailed");
      const receiverDesc = formatCardText(receiverCard, "detailed");

      // 🛠️ LÓGICA DE GIF PARA AMBAS CARTAS
      const senderIsGif =
        senderCard.artworks.is_gif ??
        /\.(gif)$/i.test(senderCard.artworks.image_url);
      const receiverIsGif =
        receiverCard.artworks.is_gif ??
        /\.(gif)$/i.test(receiverCard.artworks.image_url);

      const embedSender = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle("🤝 ¡NUEVA OFERTA DE INTERCAMBIO!")
        .setDescription(
          `**${interaction.user.username}** le ofrece a **${targetUser.username}** un intercambio.\n\n📤 **De ${interaction.user.username}:**\n${senderDesc}`,
        )
        .setImage(
          senderIsGif
            ? senderCard.artworks.image_url
            : senderCard.artworks.sample_url || senderCard.artworks.image_url,
        );

      const embedReceiver = new EmbedBuilder()
        .setColor(embedColor)
        .setDescription(
          `📥 **A cambio de la carta de ${targetUser.username}:**\n${receiverDesc}`,
        )
        .setImage(
          receiverIsGif
            ? receiverCard.artworks.image_url
            : receiverCard.artworks.sample_url ||
                receiverCard.artworks.image_url,
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("btn_accept")
          .setLabel(`Aceptar Oferta`)
          .setStyle(ButtonStyle.Success)
          .setEmoji("✅"),
        new ButtonBuilder()
          .setCustomId("btn_decline")
          .setLabel("Rechazar")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("✖️"),
      );

      const msg = await interaction.editReply({
        content: `¡Hola ${targetUser}! Tienes una nueva oferta de intercambio.`,
        embeds: [embedSender, embedReceiver],
        components: [row],
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000,
      });

      collector.on("collect", async (i) => {
        const isSender = i.user.id === interaction.user.id;
        const isReceiver = i.user.id === targetUser.id;

        if (!isSender && !isReceiver) {
          return i.reply({
            content: "No eres parte de este intercambio.",
            flags: MessageFlags.Ephemeral,
          });
        }

        // 🛠️ BLOQUEO ANTI-SPAM (Para ambas partes)
        if (!ActionManager.lockUser(i.user.id)) {
          return i.reply({
            content: "⏳ Procesando respuesta...",
            flags: MessageFlags.Ephemeral,
          });
        }

        try {
          // --- RECHAZAR ---
          if (i.customId === "btn_decline") {
            await i.deferUpdate();

            const disabledRow = new ActionRowBuilder().addComponents(
              ButtonBuilder.from(
                i.message.components[0].components[0],
              ).setDisabled(true),
              ButtonBuilder.from(
                i.message.components[0].components[1],
              ).setDisabled(true),
            );
            await interaction.editReply({ components: [disabledRow] });

            await tradeService.cancelTrade(trade.id);
            const declineSummary = new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle("🚫 Intercambio Cancelado")
              .setDescription(
                `La oferta fue rechazada por **${i.user.username}**.`,
              );

            await interaction.editReply({
              content: "",
              embeds: [declineSummary],
              components: [],
            });
            collector.stop("declined");
            return;
          }

          // --- ACEPTAR ---
          if (i.customId === "btn_accept") {
            if (!isReceiver) {
              return i.reply({
                content:
                  "Solo el usuario que recibe la oferta puede aceptarla.",
                flags: MessageFlags.Ephemeral,
              });
            }

            await i.deferUpdate();

            const disabledRow = new ActionRowBuilder().addComponents(
              ButtonBuilder.from(
                i.message.components[0].components[0],
              ).setDisabled(true),
              ButtonBuilder.from(
                i.message.components[0].components[1],
              ).setDisabled(true),
            );
            await interaction.editReply({ components: [disabledRow] });

            try {
              await tradeService.execute1v1Trade(
                trade.id,
                interaction.user.id,
                targetUser.id,
              );
              const successSummary = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle("✅ ¡Intercambio Completado!")
                .setDescription(
                  `**${interaction.user.username}** recibió: **${receiverCard.artworks.name}**\n**${targetUser.username}** recibió: **${senderCard.artworks.name}**`,
                );

              await interaction.editReply({
                content: "",
                embeds: [successSummary],
                components: [],
              });
              collector.stop("accepted");
            } catch (error) {
              await interaction.editReply({
                content: `❌ El intercambio falló: ${error.message}`,
                components: [],
                embeds: [],
              });
              collector.stop("error");
            }
          }
        } finally {
          ActionManager.unlockUser(i.user.id);
        }
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time") {
          try {
            await tradeService.cancelTrade(trade.id);
            const timeoutSummary = new EmbedBuilder()
              .setColor(0x95a5a6)
              .setTitle("⏳ Intercambio Expirado")
              .setDescription(
                `La oferta de **${interaction.user.username}** fue cancelada por falta de respuesta.`,
              );
            await interaction.editReply({
              content: "",
              embeds: [timeoutSummary],
              components: [],
            });
          } catch (e) {}
        }
      });
    } catch (err) {
      console.error("[Trade]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
