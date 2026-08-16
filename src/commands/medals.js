const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const economy = require("../services/economy");
const medalsService = require("../services/medals");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("medals")
    .setDescription("Muestra tus medallas desbloqueadas y en progreso")
    .addUserOption((opt) =>
      opt
        .setName("usuario")
        .setDescription("Usuario del que quieres ver las medallas (opcional)")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const targetUser =
        interaction.options.getUser("usuario") || interaction.user;

      // 1. Asegurar que el usuario exista
      await economy.getOrCreatePlayer(targetUser.id, targetUser.username);

      // 2. Llamar al nuevo servicio que evalúa, guarda y organiza las medallas
      const { unlocked, locked, newlyUnlockedCount } =
        await medalsService.evaluateAndGetMedals(targetUser.id);

      // 3. Construir las listas visuales
      let unlockedText = "";
      let lockedText = "";

      unlocked.forEach((medal) => {
        unlockedText += `${medal.icon} **${medal.name}**\n*${medal.description}*\n\n`;
      });

      locked.forEach((medal) => {
        const isCompleted = medal.currentProgress >= medal.condition_value;
        const displayValue = Math.min(
          medal.currentProgress,
          medal.condition_value,
        );

        let progressStr = isCompleted
          ? "¡Objetivo cumplido!"
          : `${displayValue} / ${medal.condition_value}`;

        lockedText += `🔒 **${medal.name}**\n*${medal.description}*\nProgreso: \`${progressStr}\`\n\n`;
      });

      if (!unlockedText)
        unlockedText = "*Aún no ha desbloqueado ninguna medalla.*";
      if (!lockedText)
        lockedText = "*¡Ha desbloqueado todas las medallas disponibles!*";

      const embed = new EmbedBuilder()
        .setColor(0xf1c40f) // Color dorado
        .setTitle(`🏅 Medallas de ${targetUser.username}`)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "✨ Desbloqueadas", value: unlockedText },
          { name: "🔒 Siguiente Objetivo", value: lockedText },
        );

      // Si el usuario acaba de ganar medallas gracias a abrir este comando, le avisamos con un mensaje extra
      let content = "";
      if (newlyUnlockedCount > 0 && targetUser.id === interaction.user.id) {
        content = `🎉 **¡Felicidades! Acabas de guardar ${newlyUnlockedCount} medalla(s) nueva(s) en tu vitrina.**\n`;
      }

      await interaction.editReply({
        content: content || undefined,
        embeds: [embed],
      });
    } catch (err) {
      console.error("[Medals]", err);
      await interaction.editReply({ content: `Error: ${err.message}` });
    }
  },
};
