const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const packService = require("../services/pack");
const supabase = require("../database/supabase");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("prestige")
    .setDescription(
      "Reinicia una carta nivel máximo al Nivel 1 a cambio de un enorme multiplicador permanente",
    )
    .addIntegerOption((opt) =>
      opt
        .setName("id")
        .setDescription("ID de la carta a la que le darás prestigio")
        .setRequired(true)
        .setMinValue(1),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const paId = interaction.options.getInteger("id");

      const { data: pa } = await supabase
        .from("player_artworks")
        .select("*, artworks(name)")
        .eq("id", paId)
        .eq("player_id", interaction.user.id)
        .single();

      if (!pa)
        return interaction.editReply({
          content: "❌ Artwork no encontrado en tu inventario.",
        });

      const { data: configData } = await supabase
        .from("global_configs")
        .select("value")
        .eq("key", "game_modifiers")
        .maybeSingle();

      const maxLevel = configData?.value?.max_level || 100;
      const prestigeMult = configData?.value?.prestige_multiplier || 2.0;

      if (pa.level < maxLevel) {
        return interaction.editReply({
          content: `❌ **${pa.artworks.name}** es Nivel ${pa.level}. Necesitas alcanzar el **Nivel ${maxLevel}** para activar el prestigio.`,
        });
      }

      const nextPrestige = (pa.prestige_level || 0) + 1;
      const bonusPercent = nextPrestige * prestigeMult * 100;

      const confirmEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("💠 Confirmar Prestigio 💠")
        .setDescription(
          `¿Deseas ascender **${pa.artworks.name}** a Prestigio **${nextPrestige}**?\n\n⚠️ **El nivel de la carta se reiniciará a 1.**`,
        )
        .addFields({
          name: "✨ Nueva Bonificación Permanente",
          value: `Esta carta generará **+${bonusPercent}% Ink$ adicionales** de forma permanente.`,
        })
        .setFooter({
          text: "¡El Prestigio es la clave para la máxima generación!",
        });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_prestige")
          .setLabel("Ascender a Prestigio")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("💠"),
        new ButtonBuilder()
          .setCustomId("cancel_prestige")
          .setLabel("Cancelar")
          .setStyle(ButtonStyle.Secondary),
      );

      const msg = await interaction.editReply({
        embeds: [confirmEmbed],
        components: [row],
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
        filter: (i) => i.user.id === interaction.user.id,
      });

      collector.on("collect", async (i) => {
        if (i.customId === "cancel_prestige") {
          await i.update({
            content:
              "🚫 Prestigio cancelado. Tu carta mantiene su nivel actual.",
            embeds: [],
            components: [],
          });
          collector.stop();
          return;
        }

        if (i.customId === "confirm_prestige") {
          await i.deferUpdate();
          try {
            const result = await packService.prestigeArtwork(
              interaction.user.id,
              pa.id,
            );
            const successEmbed = new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle("💠 ¡ASCENSIÓN COMPLETADA! 💠")
              .setDescription(
                `**${result.artwork.name}** ha alcanzado el **Prestigio ${result.newPrestige}**.\nSu nivel ha vuelto a 1, pero su poder de generación ahora es inmenso.`,
              );

            await interaction.editReply({
              embeds: [successEmbed],
              components: [],
            });
            collector.stop();
          } catch (error) {
            await interaction.editReply({
              content: `❌ Error al aplicar prestigio: ${error.message}`,
              embeds: [],
              components: [],
            });
            collector.stop();
          }
        }
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time")
          interaction.editReply({ components: [] }).catch(() => {});
      });
    } catch (err) {
      console.error("[Prestige]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
