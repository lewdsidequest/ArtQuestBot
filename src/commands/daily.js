const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const economy = require("../services/economy");
const supabase = require("../database/supabase");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Reclama tu recompensa diaria de Ink$ y Polvo de Estrella"),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const playerId = interaction.user.id;
      const player = await economy.getOrCreatePlayer(
        playerId,
        interaction.user.displayName,
      );

      // 1. Verificación por día de calendario (UTC)
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const lastDailyStr = player.last_daily_at
        ? new Date(player.last_daily_at).toISOString().split("T")[0]
        : null;

      if (lastDailyStr === todayStr) {
        // Calcular tiempo hasta el siguiente UTC 00:00:00
        const tomorrow = new Date(now);
        tomorrow.setUTCHours(24, 0, 0, 0); // Esto automáticamente salta al próximo día
        const diffMs = tomorrow - now;
        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        return interaction.editReply({
          content: `⏳ **Ya has reclamado tu recompensa diaria de hoy.**\n¡Vuelve en **${diffHrs}h ${diffMins}m** para reclamar de nuevo!`,
        });
      }

      // 2. Obtener la configuración global de daily_rewards
      const { data: configData } = await supabase
        .from("global_configs")
        .select("value")
        .eq("key", "daily_rewards")
        .maybeSingle();

      const config = configData?.value || {
        min_daily_ink: 2500,
        ink_multiplier: 1.0,
        min_daily_dust: 50,
        dust_multiplier: 1.0,
        jackpot_multiplier: 3.0,
        jackpot_chance: 0.05,
      };

      // 3. Ink$: Tasa de generación por hora * multiplicador (mínimo de 2500 Ink$)
      const hourlyInk = await economy.getInkRate(playerId);
      const baseInk = Math.max(
        config.min_daily_ink,
        Math.floor(hourlyInk * config.ink_multiplier),
      );

      // 4. Polvo: Cartas en inventario * multiplicador (mínimo de 50 Polvos)
      const { count: totalCards } = await supabase
        .from("player_artworks")
        .select("*, artworks!inner(status)", { count: "exact", head: true })
        .eq("player_id", playerId)
        .eq("artworks.status", "active");

      const baseDust = Math.max(
        config.min_daily_dust,
        Math.floor((totalCards || 0) * config.dust_multiplier),
      );

      // 5. Cálculo del Jackpot
      const isJackpot = Math.random() < config.jackpot_chance;
      const finalInk = isJackpot
        ? Math.floor(baseInk * config.jackpot_multiplier)
        : baseInk;
      const finalDust = isJackpot
        ? Math.floor(baseDust * config.jackpot_multiplier)
        : baseDust;

      // 6. Actualizar inventario y fecha del jugador
      const newInk = player.ink_dollars + finalInk;
      const newDust = player.star_dust + finalDust;

      const { error: updateErr } = await supabase
        .from("players")
        .update({
          ink_dollars: newInk,
          star_dust: newDust,
          last_daily_at: new Date().toISOString(),
        })
        .eq("id", playerId);

      if (updateErr) {
        throw new Error(`Error al guardar recompensa: ${updateErr.message}`);
      }

      // 7. Construir Embed
      const embed = new EmbedBuilder();

      if (isJackpot) {
        embed
          .setColor(0xf1c40f)
          .setTitle("🎉 ¡¡JACKPOT DIARIO!! 🎉")
          .setDescription(
            `¡Has tenido una suerte increíble! Tus recompensas se han multiplicado **x${config.jackpot_multiplier}**.`,
          )
          .addFields(
            {
              name: "💰 Ink Dollars",
              value: `+**${finalInk.toLocaleString()}** Ink$`,
              inline: true,
            },
            {
              name: "✨ Polvo de Estrella",
              value: `+**${finalDust.toLocaleString()}** 🌟`,
              inline: true,
            },
            {
              name: "💳 Nuevo Saldo",
              value: `**${newInk.toLocaleString()}** Ink$ | **${newDust.toLocaleString()}** Polvos`,
              inline: false,
            },
          )
          .setFooter({
            text: "¡Sigue regresando todos los días para probar tu suerte!",
          });
      } else {
        embed
          .setColor(0x2ecc71)
          .setTitle("📅 Recompensa Diaria Recolectada")
          .setDescription(
            "¡Gracias por jugar hoy! Aquí tienes tu bonificación diaria.",
          )
          .addFields(
            {
              name: "💰 Ink Dollars",
              value: `+**${finalInk.toLocaleString()}** Ink$`,
              inline: true,
            },
            {
              name: "✨ Polvo de Estrella",
              value: `+**${finalDust.toLocaleString()}** 🌟`,
              inline: true,
            },
            {
              name: "💳 Nuevo Saldo",
              value: `**${newInk.toLocaleString()}** Ink$ | **${newDust.toLocaleString()}** Polvos`,
              inline: false,
            },
          )
          .setFooter({ text: "Vuelve mañana para tu próxima recompensa" });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("[Daily]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
