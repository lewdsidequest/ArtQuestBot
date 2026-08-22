const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const economy = require("../services/economy");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("collect")
    .setDescription("Recolecta los Ink Dollars generados por tus cartas top"),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const player = await economy.getOrCreatePlayer(
        interaction.user.id,
        interaction.user.displayName,
      );

      // 1. Verificación estricta de Cooldown ANTES de calcular el dinero
      const lastClaim = new Date(player.last_claim_at).getTime();
      const cooldownHours = player.collect_cooldown_hours || 4;
      const cooldownMs = cooldownHours * 60 * 60 * 1000;
      const now = Date.now();

      if (now - lastClaim < cooldownMs) {
        const minsLeft = Math.ceil((cooldownMs - (now - lastClaim)) / 60000);

        // Formato bonito de tiempo (Ej: 2h 15m)
        const hrs = Math.floor(minsLeft / 60);
        const mins = minsLeft % 60;
        const timeString = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} minutos`;

        const inkRate = await economy.getInkRate(interaction.user.id);

        return interaction.editReply({
          content: `⏳ Tus generadores aún están trabajando. Vuelve en **${timeString}**.\n💰 Generando **${Math.floor(inkRate)}** Ink$/hora con tus mejores cartas.\n Revisa tus cartas generadoras con **/generators**`,
        });
      }

      // 2. Si pasó el cooldown, calculamos cuánto dinero hay pendiente
      const pending = await economy.calculateClaimAmount(interaction.user.id);

      if (pending <= 0) {
        const inkRate = await economy.getInkRate(interaction.user.id);
        if (inkRate <= 0) {
          return interaction.editReply({
            content:
              "❌ No tienes cartas generando ingresos. ¡Abre sobres con `/pack` para empezar a ganar Ink$!",
          });
        }
        return interaction.editReply({
          content: `⏳ Aún no tienes ingresos listos para recolectar.\n💰 Generando **${Math.floor(inkRate)}** Ink$/hora.`,
        });
      }

      // 3. Ejecutar la recolección
      const result = await economy.claim(interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("💰 Ink Dollars Recolectados")
        .setDescription(
          `Has recolectado **${result.amount.toLocaleString()}** Ink Dollars de tus generadores.`,
        )
        .addFields({
          name: "Nuevo Balance",
          value: `${result.newBalance.toLocaleString()} Ink$`,
          inline: true,
        });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error("[Collect]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
