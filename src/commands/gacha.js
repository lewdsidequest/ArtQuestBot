const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require("discord.js");
const gamblingService = require("../services/gambling");
const economy = require("../services/economy");
const RarityManager = require("../utils/rarity");
const ActionManager = require("../utils/ActionManager"); // 🛠️ GESTOR ANTI-SPAM

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gacha")
    .setDescription(
      "Abre cápsulas promocionales para obtener cartas exclusivas",
    )
    .addIntegerOption((opt) =>
      opt
        .setName("banner")
        .setDescription("Selecciona el Banner Promocional")
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const machineId = interaction.options.getInteger("banner");
      const machines = await gamblingService.getActiveMachines("gacha");
      const machine = machines.find((m) => m.id === machineId);

      if (!machine) {
        return interaction.editReply({
          content: "❌ Banner no encontrado o finalizado.",
        });
      }

      const player = await economy.getOrCreatePlayer(
        interaction.user.id,
        interaction.user.username,
      );
      const costFormatted = machine.max_bet.toLocaleString();

      const initEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`🔮 ${machine.name}`)
        .setDescription(
          `💳 **Saldo Actual:** **${player.ink_dollars.toLocaleString()} Ink$**\n\n` +
            `¡Bienvenido al Banner Promocional!\n\n` +
            `🎯 Cada tirada tiene la posibilidad de otorgarte Ink Dollars como premio de consuelo o el premio mayor: ¡Una **Carta Exclusiva**!\n\n` +
            `💵 **Costo por Tirada:** ${costFormatted} Ink$`,
        );

      if (machine.config?.thumbnail_url) {
        initEmbed.setThumbnail(machine.config.thumbnail_url);
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("gacha_pull")
          .setLabel(`Tirar (${costFormatted} Ink$)`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🎟️"),
      );

      const msg = await interaction.editReply({
        embeds: [initEmbed],
        components: [row],
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000,
        filter: (i) => i.user.id === interaction.user.id,
      });

      collector.on("collect", async (i) => {
        if (i.customId === "gacha_pull") {
          if (!ActionManager.lockUser(interaction.user.id)) {
            return i.reply({
              content: "⏳ Abriendo cápsula...",
              flags: MessageFlags.Ephemeral,
            });
          }

          try {
            await i.deferUpdate();

            const disabledRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder(
                i.message.components[0].components[0].data,
              ).setDisabled(true),
            );
            await interaction.editReply({ components: [disabledRow] });

            const currentP = await economy.getPlayer(interaction.user.id);
            if (currentP.ink_dollars < machine.max_bet) {
              await i.editReply({
                content: `❌ No tienes suficientes fondos. Necesitas **${costFormatted} Ink$**.`,
                components: [],
              });
              collector.stop("no_funds");
              return;
            }

            const result = await gamblingService.playGacha(
              interaction.user.id,
              machine,
            );
            const newBal = (
              currentP.ink_dollars -
              machine.max_bet +
              result.inkWinnings
            ).toLocaleString();

            const pullEmbed = new EmbedBuilder().setTitle(
              `Banner: ${machine.name}`,
            );
            if (machine.config?.thumbnail_url)
              pullEmbed.setThumbnail(machine.config.thumbnail_url);

            let capsuleEmoji = "⚪";
            if (result.isJackpot) {
              capsuleEmoji = "💖";
              pullEmbed.setColor(0xff1493);
            } else if (result.inkWinnings > machine.max_bet) {
              capsuleEmoji = "🟡";
              pullEmbed.setColor(0xf1c40f);
            } else if (result.inkWinnings > machine.max_bet * 0.5) {
              capsuleEmoji = "🔵";
              pullEmbed.setColor(0x3498db);
            } else {
              pullEmbed.setColor(0x95a5a6);
            }

            let desc = `💳 **Saldo Actual:** **${newBal} Ink$**\n\n`;
            desc += `Has abierto la cápsula... ${capsuleEmoji}\n\n`;

            if (result.inkWinnings > 0) {
              desc += `💸 Premio: **+${result.inkWinnings.toLocaleString()} Ink$**\n`;
            } else if (!result.isJackpot) {
              desc += `💨 La cápsula estaba vacía. ¡Suerte a la próxima!\n`;
            }

            if (result.isJackpot && result.cardWon) {
              desc += `\n🎉 **¡¡OBTUVISTE UNA CARTA EXCLUSIVA!!** 🎉\n`;

              const rarityData = RarityManager.get(result.cardWon.rarity_id);
              const rarityDisplay = rarityData
                ? `${rarityData.name} ${rarityData.emoji}`
                : "Desconocida";

              desc += `🖼️ **${result.cardWon.name}** (${rarityDisplay})\n`;

              if (result.isDuplicate) {
                desc += `🔁 *(Es un duplicado, se ha guardado en tu inventario)*\n`;
              }
              desc += `\n🔍 Usa \`/view ID:${result.cardWonPaId}\` para verla a detalle.`;

              // 🛠️ LÓGICA DE GIF APLICADA A GACHA
              const isGif =
                result.cardWon.is_gif ??
                /\.(gif)$/i.test(result.cardWon.image_url);
              pullEmbed.setThumbnail(null);
              pullEmbed.setImage(
                isGif
                  ? result.cardWon.image_url
                  : result.cardWon.sample_url || result.cardWon.image_url,
              );

              pullEmbed.setDescription(desc);
              await i.editReply({ embeds: [pullEmbed], components: [] });
              collector.stop("jackpot");
              return;
            }

            pullEmbed.setDescription(desc);
            await i.editReply({ embeds: [pullEmbed], components: [row] });
            collector.resetTimer();
          } catch (e) {
            await i.editReply({
              content: `❌ Error al tirar: ${e.message}`,
              components: [],
            });
            collector.stop("error");
          } finally {
            ActionManager.unlockUser(interaction.user.id);
          }
        }
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time")
          interaction.editReply({ components: [] }).catch(() => {});
      });
    } catch (err) {
      console.error("[Gacha]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },

  async autocomplete(interaction) {
    try {
      const focused = interaction.options.getFocused();
      const machines = await gamblingService.getActiveMachines("gacha");
      const filtered = machines
        .filter((m) => m.name.toLowerCase().includes(focused.toLowerCase()))
        .slice(0, 25);
      await interaction.respond(
        filtered.map((m) => ({ name: m.name, value: m.id })),
      );
    } catch (e) {
      await interaction.respond([]);
    }
  },
};
