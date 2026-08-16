const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const gamblingService = require("../services/gambling");
const economy = require("../services/economy");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gambling")
    .setDescription("Prueba tu suerte en las máquinas tragamonedas (Slots)")
    .addIntegerOption((opt) =>
      opt
        .setName("maquina")
        .setDescription("Selecciona la máquina a la que quieres jugar")
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const machineId = interaction.options.getInteger("maquina");
      const machines = await gamblingService.getActiveMachines("slots");
      const machine = machines.find((m) => m.id === machineId);

      if (!machine) {
        return interaction.editReply({
          content: "❌ Máquina no encontrada o fuera de servicio.",
        });
      }

      // Configuración de apuestas persistente en la sesión
      const minBet = machine.config?.min_bet || 10;
      const maxBet = machine.max_bet;
      let currentBet = machine.config?.default_bet || Math.floor(maxBet / 2);
      const isDust = machine.machine_type === "dust_slots";
      const currency = isDust ? "🌟 Polvo" : "💰 Ink$";

      // ==========================================
      // FUNCIÓN: CONSTRUIR EMBED INICIAL
      // ==========================================
      const buildInitEmbed = async (playerId) => {
        const player = await economy.getPlayer(playerId);
        const bal = isDust ? player.star_dust : player.ink_dollars;

        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`🎰 ${machine.name}`)
          .setDescription(
            `💳 **Tu Saldo:** **${bal.toLocaleString()} ${currency}**\n\n` +
              `¡Bienvenido a la tragamonedas!\n\n` +
              `💵 **Apuesta Actual:** ${currentBet.toLocaleString()} ${currency}\n` +
              `*(Límites: ${minBet.toLocaleString()} - ${maxBet.toLocaleString()})*`,
          );

        if (machine.config?.thumbnail_url) {
          embed.setThumbnail(machine.config.thumbnail_url);
        }
        return embed;
      };

      // ==========================================
      // ESTADO INICIAL
      // ==========================================
      const initEmbed = await buildInitEmbed(interaction.user.id);

      const buildRow = () => {
        return new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("gamble_spin")
            .setLabel(`Apostar (${currentBet.toLocaleString()})`)
            .setStyle(ButtonStyle.Success)
            .setEmoji("🎰"),
          new ButtonBuilder()
            .setCustomId("gamble_change_bet")
            .setLabel("Cambiar Apuesta")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("✏️"),
        );
      };

      const msg = await interaction.editReply({
        embeds: [initEmbed],
        components: [buildRow()],
      });

      // ==========================================
      // COLECTOR DE BOTONES Y MODALES
      // ==========================================
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000,
        filter: (i) => i.user.id === interaction.user.id,
      });

      collector.on("collect", async (i) => {
        // --- CAMBIAR APUESTA (MODAL) ---
        if (i.customId === "gamble_change_bet") {
          const modal = new ModalBuilder()
            .setCustomId("modal_change_bet")
            .setTitle("Configurar Apuesta");

          const betInput = new TextInputBuilder()
            .setCustomId("input_bet_amount")
            .setLabel(`Mínimo: ${minBet} | Máximo: ${maxBet}`)
            .setStyle(TextInputStyle.Short)
            .setValue(String(currentBet))
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(betInput));
          await i.showModal(modal);

          try {
            const submitted = await i.awaitModalSubmit({
              time: 60000,
              filter: (m) =>
                m.user.id === interaction.user.id &&
                m.customId === "modal_change_bet",
            });

            const newVal = parseInt(
              submitted.fields.getTextInputValue("input_bet_amount"),
            );

            if (isNaN(newVal) || newVal < minBet || newVal > maxBet) {
              await submitted.reply({
                content: `❌ Cantidad inválida. Debe estar entre **${minBet.toLocaleString()}** y **${maxBet.toLocaleString()}**.`,
                ephemeral: true,
              });
            } else {
              currentBet = newVal;
              const newInitEmbed = await buildInitEmbed(interaction.user.id);
              await submitted.update({
                embeds: [newInitEmbed],
                components: [buildRow()],
              });
              collector.resetTimer();
            }
          } catch (e) {
            // Modal expiró, no hacemos nada
          }
          return;
        }

        // --- APOSTAR (SPIN) ---
        if (i.customId === "gamble_spin") {
          await i.deferUpdate();

          try {
            const result = await gamblingService.playSlots(
              interaction.user.id,
              machine,
              currentBet,
            );
            const player = await economy.getPlayer(interaction.user.id);
            const newBal = isDust ? player.star_dust : player.ink_dollars;

            const spinEmbed = new EmbedBuilder().setTitle(`🎰 ${machine.name}`);
            if (machine.config?.thumbnail_url)
              spinEmbed.setThumbnail(machine.config.thumbnail_url);

            spinEmbed.setColor(
              result.winnings > 0
                ? result.isJackpot
                  ? 0xf1c40f
                  : 0x2ecc71
                : 0xe74c3c,
            );

            // Generador simple de emojis para slots
            const emojis = ["🍒", "🍋", "🔔", "💎", "🎰"];
            const e1 = emojis[Math.floor(Math.random() * emojis.length)];
            const e2 =
              result.winnings > 0
                ? e1
                : emojis[Math.floor(Math.random() * emojis.length)];
            const e3 = result.isJackpot
              ? e1
              : result.winnings > 0
                ? emojis[Math.floor(Math.random() * emojis.length)]
                : e1;

            let slotDisplay = result.isJackpot
              ? `[ 🎰 | 🎰 | 🎰 ]`
              : `[ ${e1} | ${e2} | ${e3} ]`;

            let desc = `💳 **Saldo Actual:** **${newBal.toLocaleString()} ${currency}**\n\n`;
            desc += `\`\`\`text\n      ${slotDisplay}      \n\`\`\`\n`;
            desc += `Apuesta: **${currentBet.toLocaleString()} ${currency}**\n\n`;

            if (result.winnings > 0) {
              desc += result.isJackpot
                ? `🎉 **¡¡JACKPOT!!** 🎉\n`
                : `✅ **¡GANASTE!**\n`;
              desc += `Has ganado **${result.winnings.toLocaleString()} ${currency}** (x${result.multiplier})\n`;
            } else {
              desc += `❌ **Perdiste.** Mejor suerte la próxima vez.\n`;
            }

            spinEmbed.setDescription(desc);

            // 🎯 LÓGICA DE JACKPOT
            if (result.isJackpot && machine.config?.jackpot_image_url) {
              spinEmbed.setThumbnail(null);
              spinEmbed.setImage(machine.config.jackpot_image_url);
              await i.editReply({ embeds: [spinEmbed], components: [] });
              collector.stop("jackpot");
              return;
            }

            await i.editReply({
              embeds: [spinEmbed],
              components: [buildRow()],
            });
            collector.resetTimer();
          } catch (e) {
            // Si no tiene dinero u ocurre un error, avisamos pero MANTENEMOS la botonera
            // para que pueda usar el botón "Cambiar Apuesta" y bajarla.
            await interaction.followUp({
              content: `❌ ${e.message}`,
              ephemeral: true,
            });
            collector.resetTimer();
          }
        }
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time")
          interaction.editReply({ components: [] }).catch(() => {});
      });
    } catch (err) {
      console.error("[Gambling]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },

  async autocomplete(interaction) {
    try {
      const focused = interaction.options.getFocused();
      const machines = await gamblingService.getActiveMachines("slots");

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
