const { SlashCommandBuilder } = require("discord.js");
const economy = require("../services/economy");
const supabase = require("../database/supabase");
const { buildProfileEmbed } = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Muestra tu perfil y estadísticas")
    .addUserOption((opt) =>
      opt
        .setName("usuario")
        .setDescription("Ver perfil de otro jugador")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const target = interaction.options.getUser("usuario") || interaction.user;
      const player = await economy.getPlayer(target.id);

      if (!player) {
        await interaction.editReply({
          content:
            target.id === interaction.user.id
              ? "Aún no estás registrado. Usa `/register` para empezar."
              : "Ese usuario no está registrado.",
        });
        return;
      }

      // 1. Obtener los ingresos reales y las cartas generadoras activas
      const inkRate = await economy.getInkRate(target.id);
      const topGenerators = await economy.getTopGeneratorsDetails(target.id);

      // Conteo de cuántas cartas están realmente generando de los espacios disponibles
      const activeGeneratorsCount = topGenerators.length;

      // 2. Buscar carta destacada (Amada)
      let bestCard = null;
      const { data: lovedCard } = await supabase
        .from("player_artworks")
        .select("*, artworks(name, image_url, sample_url, rarity_id)") // 🛠️ CORREGIDO a rarity_id
        .eq("player_id", target.id)
        .eq("is_loved", true)
        .maybeSingle();

      if (lovedCard) {
        bestCard = lovedCard;
      } else if (topGenerators.length > 0) {
        // Si no hay carta amada, usamos la que más genera de la lista de generadoras
        bestCard = topGenerators[0];
      } else {
        // Fallback final: La carta de mayor nivel/estrellas
        const { data: topCardData } = await supabase
          .from("player_artworks")
          .select("*, artworks(name, image_url, sample_url, rarity_id)")
          .eq("player_id", target.id)
          .order("level", { ascending: false })
          .order("stars", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (topCardData) bestCard = topCardData;
      }

      // 3. Buscar Top 5 Medallas
      const { data: rawMedals } = await supabase
        .from("player_medals")
        .select("medals(name, icon, condition_value)")
        .eq("player_id", target.id);

      let medalsText = "No tiene medallas aún.";
      if (rawMedals && rawMedals.length > 0) {
        const sortedMedals = rawMedals
          .map((m) => m.medals)
          .sort((a, b) => b.condition_value - a.condition_value)
          .slice(0, 5);

        medalsText = sortedMedals.map((m) => `${m.icon} ${m.name}`).join("\n");
      }

      // 4. Construir Embed usando la función centralizada de embeds.js
      const embed = buildProfileEmbed(
        player,
        target,
        inkRate,
        bestCard,
        activeGeneratorsCount,
        medalsText,
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("[Profile]", err);
      await interaction.editReply({ content: `Error: ${err.message}` });
    }
  },
};
