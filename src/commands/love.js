const { SlashCommandBuilder } = require("discord.js");
const supabase = require("../database/supabase");
const { buildArtworkEmbed } = require("../utils/embeds");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("love")
    .setDescription("Gestiona tu carta amada (destacada)")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Asigna una carta como tu amada principal")
        .addStringOption((opt) =>
          opt
            .setName("id")
            .setDescription("ID único de la carta en tu inventario (ej. 12345)")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Quita el estatus de 'amada' a tu carta actual"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("Observa a tu carta amada actual a todo detalle"),
    ),

  async execute(interaction) {
    await interaction.deferReply();
    try {
      const sub = interaction.options.getSubcommand();
      const playerId = interaction.user.id;

      // ==========================================
      // ADD: Asignar una nueva carta amada
      // ==========================================
      if (sub === "add") {
        const paId = interaction.options.getString("id");

        // Verificar que la carta exista y le pertenezca
        const { data: card, error: cardErr } = await supabase
          .from("player_artworks")
          .select("id")
          .eq("id", paId)
          .eq("player_id", playerId)
          .single();

        if (cardErr || !card) {
          return interaction.editReply(
            "❌ No se encontró esa carta en tu inventario (Verifica que el ID sea correcto).",
          );
        }

        // 1. Quitar el estatus de amada a cualquier otra carta que tuviera
        await supabase
          .from("player_artworks")
          .update({ is_loved: false })
          .eq("player_id", playerId);

        // 2. Asignar el nuevo amor
        await supabase
          .from("player_artworks")
          .update({ is_loved: true })
          .eq("id", paId);

        return interaction.editReply(
          `💖 ¡Has asignado la carta con ID **${paId}** como tu nueva carta amada! Ahora aparecerá en tu perfil.`,
        );
      }

      // ==========================================
      // REMOVE: Quitar la carta amada actual
      // ==========================================
      if (sub === "remove") {
        await supabase
          .from("player_artworks")
          .update({ is_loved: false })
          .eq("player_id", playerId);

        return interaction.editReply(
          "💔 Has roto el vínculo. Ya no tienes ninguna carta amada destacada.",
        );
      }

      // ==========================================
      // VIEW: Mostrar la carta amada actual
      // ==========================================
      if (sub === "view") {
        const { data: lovedCard, error: lovedErr } = await supabase
          .from("player_artworks")
          .select("*, artworks(*)")
          .eq("player_id", playerId)
          .eq("is_loved", true)
          .maybeSingle();

        if (lovedErr || !lovedCard) {
          return interaction.editReply(
            "❌ Actualmente no tienes ninguna carta amada. Usa `/love add [id]` para elegir una.",
          );
        }

        const embed = buildArtworkEmbed(lovedCard.artworks, {
          playerArtwork: lovedCard,
          ownerUsername: interaction.user.username,
          showVideoText: true,
        });

        // Darle un toque visual extra al embed
        embed.setColor(0xff1493); // Rosa fuerte
        embed.setTitle(`💖 Carta Amada: ${lovedCard.artworks.name}`);

        return interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      console.error("[Love]", error);
      await interaction.editReply(
        `❌ Error al gestionar la carta amada: ${error.message}`,
      );
    }
  },
};
