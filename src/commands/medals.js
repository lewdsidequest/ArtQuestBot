const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require("discord.js");
const economy = require("../services/economy");
const medalsService = require("../services/medals");
const ActionManager = require("../utils/ActionManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("medals")
    .setDescription("Revisa tu progreso y reclama recompensas de medallas")
    .addUserOption((opt) =>
      opt
        .setName("usuario")
        .setDescription("Usuario del que quieres ver las medallas")
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const targetUser =
        interaction.options.getUser("usuario") || interaction.user;
      await economy.getOrCreatePlayer(targetUser.id, targetUser.displayName);

      // Extraemos la información del servicio
      const { unlocked, locked, newlyUnlockedCount } =
        await medalsService.evaluateAndGetMedals(targetUser.id);

      // Categorizamos las medallas
      let pendingClaim = unlocked.filter((m) => !m.is_claimed);
      let claimed = unlocked.filter((m) => m.is_claimed);

      // Ordenamos las bloqueadas por porcentaje de progreso (las más cercanas a completarse primero)
      let lockedSorted = locked.sort((a, b) => {
        const ratioA = (a.currentProgress || 0) / a.condition_value;
        const ratioB = (b.currentProgress || 0) / b.condition_value;
        return ratioB - ratioA;
      });

      // El orden de visualización principal: 1. Por reclamar, 2. En progreso, 3. Completadas
      let allMedals = [...pendingClaim, ...lockedSorted, ...claimed];

      const perPage = 5;
      let totalPages = Math.max(1, Math.ceil(allMedals.length / perPage));
      let currentPage = 1;

      // Función para renderizar la página actual en vivo
      const renderPage = (page) => {
        const start = (page - 1) * perPage;
        const pageMedals = allMedals.slice(start, start + perPage);

        let desc = "";
        const claimButtons = [];

        pageMedals.forEach((medal) => {
          // Si está pendiente por reclamar
          if (pendingClaim.includes(medal)) {
            let rewards = [];
            if (medal.reward_ink)
              rewards.push(`${medal.reward_ink.toLocaleString()} Ink$`);
            if (medal.reward_dust)
              rewards.push(`${medal.reward_dust.toLocaleString()} Polvo`);
            if (medal.reward_card_id) rewards.push(`Carta Exclusiva`);
            const rewardText =
              rewards.length > 0 ? rewards.join(" | ") : "Recompensa Secreta";

            desc += `🎁 **${medal.name}**\n*${medal.description}*\n> 💰 **Recompensa:** ${rewardText}\n\n`;

            // Si el usuario es el dueño, le agregamos un botón de reclamo
            if (targetUser.id === interaction.user.id) {
              claimButtons.push(
                new ButtonBuilder()
                  .setCustomId(`claim_${medal.id}`)
                  .setLabel(`Reclamar ${medal.name}`)
                  .setStyle(ButtonStyle.Success)
                  .setEmoji("🎁"),
              );
            }
          }
          // Si ya fue reclamada / completada
          else if (claimed.includes(medal)) {
            desc += `🏅 **${medal.name}**\n*${medal.description}*\n> ✅ **Completada**\n\n`;
          }
          // Si sigue bloqueada
          else {
            const current = medal.currentProgress || 0;
            const ratio = Math.min(1, current / medal.condition_value);
            const percent = Math.floor(ratio * 100);

            desc += `🔒 **${medal.name}**\n*${medal.description}*\n> 📊 **Progreso:** \`${current.toLocaleString()} / ${medal.condition_value.toLocaleString()}\` (${percent}%)\n\n`;
          }
        });

        const embed = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(`🏅 Logros y Medallas de ${targetUser.displayName}`)
          .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
          .setDescription(
            desc || "*No hay medallas registradas en el sistema aún.*",
          )
          .setFooter({
            text: `Página ${page}/${totalPages} | Total: ${unlocked.length} medallas desbloqueadas`,
          });

        const rows = [];

        // Fila de Navegación
        const navRow = new ActionRowBuilder();
        if (page > 1)
          navRow.addComponents(
            new ButtonBuilder()
              .setCustomId("nav_prev")
              .setLabel("◀ Anterior")
              .setStyle(ButtonStyle.Primary),
          );
        if (page < totalPages)
          navRow.addComponents(
            new ButtonBuilder()
              .setCustomId("nav_next")
              .setLabel("Siguiente ▶")
              .setStyle(ButtonStyle.Primary),
          );
        if (navRow.components.length > 0) rows.push(navRow);

        // Fila de Botones de Reclamo (Máximo 5 botones por fila, pero como paginamos de a 5, cabe perfecto)
        if (claimButtons.length > 0) {
          rows.push(
            new ActionRowBuilder().addComponents(...claimButtons.slice(0, 5)),
          );
        }

        return { embeds: [embed], components: rows };
      };

      let initialContent = "";
      if (newlyUnlockedCount > 0 && targetUser.id === interaction.user.id) {
        initialContent = `🎉 **¡Felicidades! Has cumplido el objetivo de ${newlyUnlockedCount} medalla(s) nueva(s).**\n`;
      }

      const msg = await interaction.editReply({
        content: initialContent || undefined,
        ...renderPage(currentPage),
      });

      // Collector para botones de navegación y reclamo
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120000,
        filter: (i) => i.user.id === interaction.user.id,
      });

      collector.on("collect", async (i) => {
        if (!ActionManager.lockUser(i.user.id)) return;

        try {
          // NAVEGACIÓN
          if (i.customId === "nav_prev" || i.customId === "nav_next") {
            if (i.customId === "nav_prev") currentPage--;
            if (i.customId === "nav_next") currentPage++;
            await i.update(renderPage(currentPage));
            collector.resetTimer();
            return;
          }

          // RECLAMAR RECOMPENSA
          if (i.customId.startsWith("claim_")) {
            const medalId = parseInt(i.customId.split("_")[1]);

            try {
              const rewards = await medalsService.claimMedalReward(
                interaction.user.id,
                medalId,
              );

              // Actualizamos nuestras listas en memoria para que el UI cambie al instante
              const claimedMedal = pendingClaim.find((m) => m.id === medalId);
              if (claimedMedal) {
                pendingClaim = pendingClaim.filter((m) => m.id !== medalId);
                claimedMedal.is_claimed = true;
                claimed.push(claimedMedal);
                // Reconstruimos la lista global
                allMedals = [...pendingClaim, ...lockedSorted, ...claimed];
              }

              let rewardMsg = `✅ **¡Recompensa Reclamada!**\n`;
              if (rewards.ink > 0)
                rewardMsg += `💰 +${rewards.ink.toLocaleString()} Ink$\n`;
              if (rewards.dust > 0)
                rewardMsg += `🌟 +${rewards.dust.toLocaleString()} Polvo\n`;
              if (rewards.cardId)
                rewardMsg += `🖼️ +1 Carta Exclusiva (Usa \`/view id:${rewards.cardId}\` para verla)\n`;

              await i.reply({
                content: rewardMsg,
                flags: MessageFlags.Ephemeral,
              });

              // Actualizamos el embed para quitar el botón
              await interaction.editReply(renderPage(currentPage));
              collector.resetTimer();
            } catch (err) {
              await i.reply({
                content: `❌ Error: ${err.message}`,
                flags: MessageFlags.Ephemeral,
              });
            }
          }
        } finally {
          ActionManager.unlockUser(i.user.id);
        }
      });

      collector.on("end", () => {
        interaction.editReply({ components: [] }).catch(() => {});
      });
    } catch (err) {
      console.error("[Medals]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
