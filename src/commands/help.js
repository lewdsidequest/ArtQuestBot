const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Centro de ayuda rápida y navegación del bot"),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("🆘 Centro de Ayuda")
      .setDescription(
        "Información del juego, comandos y consejos para mejorar tu experiencia.",
      )
      .addFields(
        {
          name: "🌱 ¿Eres nuevo en el bot?",
          value:
            "Usa el comando **`/tutorial`**. Tardas menos de 2 minutos en leerlo y te salvará de cometer errores de novato.",
        },
        {
          name: "📜 Lista de Comandos",
          value:
            "Usa **`/info comandos`** para ver una lista de comandos disponibles y su funcionamiento.",
        },
        {
          name: "📦 Probabilidades y Reglas",
          value:
            "Usa **`/info packs`** para entender cómo funcionan las rarezas al abrir sobres.",
        },
        {
          name: "🏭 Generación de Ingresos",
          value:
            "Puedes ver tus cartas más fuertes y tu límite de generación actual usando el comando **`/generators`**.",
        },
      )
      .setFooter({ text: "¡Buena suerte!" });

    await interaction.reply({ embeds: [embed] });
  },
};
