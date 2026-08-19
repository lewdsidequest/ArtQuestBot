const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const economy = require("../services/economy");
const packService = require("../services/pack");
const { formatCardText } = require("../utils/cardFormat");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("favorite")
    .setDescription(
      "Añade o quita cartas de tu lista de favoritos para protegerlas",
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Añade una o varias cartas a favoritos")
        .addStringOption((opt) =>
          opt
            .setName("ids")
            .setDescription(
              "IDs separados por comas o espacios (ej. 12, 45, 102)",
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Quita una o varias cartas de favoritos")
        .addStringOption((opt) =>
          opt
            .setName("ids")
            .setDescription(
              "IDs separados por comas o espacios (ej. 12, 45, 102)",
            )
            .setRequired(true),
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();
    try {
      const playerId = interaction.user.id;
      await economy.getOrCreatePlayer(playerId, interaction.user.username);

      const sub = interaction.options.getSubcommand();
      const idsString = interaction.options.getString("ids");

      // 🛠️ Extraer IDs numéricos limpiando comas y múltiples espacios
      const rawIds = idsString
        .split(/[,\s]+/)
        .map(Number)
        .filter((n) => !isNaN(n) && n > 0);
      const uniqueIds = [...new Set(rawIds)]; // Eliminar duplicados

      if (uniqueIds.length === 0) {
        return interaction.editReply(
          "❌ No proporcionaste ningún ID numérico válido. Ejemplo de uso: `12, 45, 102`",
        );
      }

      // 🛠️ Límite anti-spam para no saturar los Embeds de Discord
      if (uniqueIds.length > 20) {
        return interaction.editReply(
          "❌ Por favor, actualiza un máximo de 20 cartas a la vez.",
        );
      }

      const isAdding = sub === "add";

      // Llamar al servicio para actualizar la base de datos
      const affectedCards = await packService.setFavorites(
        playerId,
        uniqueIds,
        isAdding,
      );

      // 🛠️ Formatear las cartas modificadas usando el modo 'minimalist'
      const cardsText = affectedCards
        .map((card) => formatCardText(card, "minimalist"))
        .join("\n");

      const embed = new EmbedBuilder()
        .setColor(isAdding ? 0xf1c40f : 0x95a5a6) // Dorado para añadir, Gris para quitar
        .setTitle(
          isAdding ? "💎 Añadidas a Favoritos" : "🗑️ Removidas de Favoritos",
        )
        .setDescription(
          `Se han actualizado **${affectedCards.length}** cartas:\n\n${cardsText}`,
        );

      // Si el usuario puso un ID que no le pertenece, le avisamos sutilmente en el footer
      if (affectedCards.length < uniqueIds.length) {
        const ignoredCount = uniqueIds.length - affectedCards.length;
        embed.setFooter({
          text: `⚠️ ${ignoredCount} ID(s) fueron ignorados (no existen o no te pertenecen).`,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("[Favorite]", error);
      await interaction.editReply(`❌ Error: ${error.message}`);
    }
  },
};
