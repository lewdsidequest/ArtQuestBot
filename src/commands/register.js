const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const economy = require("../services/economy");
const { buildProfileEmbed } = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("register")
    .setDescription("Regístrate en el juego y empieza tu galería"),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const player = await economy.getOrCreatePlayer(
        interaction.user.id,
        interaction.user.displayName,
      );

      const inkRate = await economy.getInkRate(interaction.user.id);

      // 🛠️ CORREGIDO: Añadimos interaction.user como segundo parámetro
      const embed = buildProfileEmbed(player, interaction.user, inkRate);

      await interaction.editReply({
        content:
          "¡Bienvenido(a) a **ArtTradingBot**! Tu perfil ha sido creado (GLOBAL).",
        embeds: [embed],
      });
    } catch (err) {
      console.error("[Register]", err);
      await interaction.editReply({ content: `Error: ${err.message}` });
    }
  },
};
