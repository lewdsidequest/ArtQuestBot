const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const economy = require("../services/economy");
const { formatCardText } = require("../utils/cardFormat");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("generators")
    .setDescription(
      "Muestra tus mejores cartas que están generando Ink Dollars",
    )
    .addUserOption((opt) =>
      opt
        .setName("usuario")
        .setDescription("Ver los generadores de otro jugador")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const targetUser =
        interaction.options.getUser("usuario") || interaction.user;
      const player = await economy.getPlayer(targetUser.id);

      if (!player) {
        return interaction.editReply({
          content:
            targetUser.id === interaction.user.id
              ? "❌ Aún no estás registrado. Usa `/register`."
              : "❌ Ese usuario no está registrado.",
        });
      }

      // Obtener el Top de cartas y el total que generan
      const topCards = await economy.getTopGeneratorsDetails(targetUser.id);
      const totalRate = await economy.getInkRate(targetUser.id);

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71) // Verde dinero
        .setTitle(`🏭 Generadores de ${player.username || targetUser.username}`)
        .setDescription(
          `Tu límite actual de producción simultánea es de **${player.generator_limit} cartas**.\n*Tus mejores cartas se asignan automáticamente a estos espacios.*\n\n`,
        );

      if (topCards.length === 0) {
        embed.setDescription(
          embed.data.description +
            "*No tienes cartas en tu inventario. ¡Abre sobres para empezar a generar!*",
        );
      } else {
        let listText = "";
        topCards.forEach((card, index) => {
          // 🛠️ Usamos el formato estandarizado y le agregamos la estadística de generación abajo
          const cardStr = formatCardText(card, "detailed", index + 1);
          listText += `${cardStr}\n└ ➔ **💰 ${card.rate} Ink$/hora**\n\n`;
        });

        embed.setDescription(embed.data.description + listText);
      }

      embed.addFields({
        name: "Total Generado",
        value: `**💰 ${Math.floor(totalRate).toLocaleString()} Ink$/hora**`,
        inline: false,
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("[Generators]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
