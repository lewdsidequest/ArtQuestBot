const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const economy = require("../services/economy");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("money")
    .setDescription(
      "Muestra un resumen rápido de tus finanzas y generación de ingresos",
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const player = await economy.getOrCreatePlayer(
        interaction.user.id,
        interaction.user.username,
      );

      const inkRate = await economy.getInkRate(interaction.user.id);
      const maxHours = player.max_offline_hours || 3;
      const maxAccumulation = Math.floor(inkRate * maxHours);

      // Obtener cuántas cartas están realmente generando actualmente
      const generators = await economy.getTopGeneratorsDetails(
        interaction.user.id,
      );
      const activeCount = generators.length;

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71) // Verde dinero
        .setTitle("🏦 Resumen Financiero")
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          {
            name: "💰 Ink Dollars",
            value: `**${player.ink_dollars.toLocaleString()}** Ink$`,
            inline: true,
          },
          {
            name: "✨ Polvo de Estrella",
            value: `**${player.star_dust.toLocaleString()}** 🌟`,
            inline: true,
          },
          { name: "\u200B", value: "\u200B", inline: false }, // Espaciador
          {
            name: "📈 Generación Activa",
            value: `Generando **${Math.floor(inkRate).toLocaleString()} Ink$/hora** usando tus mejores **${activeCount}/${player.generator_limit}** cartas.`,
            inline: false,
          },
          {
            name: "📦 Capacidad de Acumulación",
            value: `Puedes acumular hasta un máximo de **${maxAccumulation.toLocaleString()} Ink$** (Límite de ${maxHours} horas offline).`,
            inline: false,
          },
        )
        .setFooter({
          text: "💡 Tip: Usa /collect regularmente para no desperdiciar ingresos al llegar a tu tope.",
        });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("[Money]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
