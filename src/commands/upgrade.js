const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const supabase = require("../database/supabase");
const economy = require("../services/economy");
const packService = require("../services/pack");
const { buildArtworkEmbed } = require("../utils/embeds");
const {
  calculateInkRate,
  calculateLevelUpgradeCost,
  calculateStarUpgradeCost,
} = require("../utils/power");
const ActionManager = require("../utils/ActionManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("upgrade")
    .setDescription(
      "Mejora el nivel o las estrellas de tus cartas de forma interactiva",
    )
    .addSubcommand((sub) =>
      sub
        .setName("single_view")
        .setDescription("Mejora una carta específica buscando por su ID")
        .addIntegerOption((opt) =>
          opt.setName("id").setDescription("ID de la carta").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("inventory_view")
        .setDescription("Navega y mejora todas las cartas de tu inventario"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("favorites_view")
        .setDescription("Navega y mejora solo tus cartas favoritas"),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const sub = interaction.options.getSubcommand();
      const playerId = interaction.user.id;
      const playerDisplayName =
        interaction.member?.displayName || interaction.user.displayName;

      await economy.getOrCreatePlayer(playerId, interaction.user.displayName);

      const { data: configData } = await supabase
        .from("global_configs")
        .select("key, value")
        .in("key", ["economy_costs", "game_modifiers"]);
      const ecoConfig =
        configData?.find((c) => c.key === "economy_costs")?.value || {};
      const gameModifiers =
        configData?.find((c) => c.key === "game_modifiers")?.value || {};

      // 🛠️ Extraemos el límite de nivel configurado en tu BD (O 100 por defecto)
      const MAX_LEVEL_LIMIT =
        ecoConfig.max_level || gameModifiers.max_level || 100;
      const MAX_STARS_LIMIT = 10;

      let currentPage = 1;
      let totalPages = 1;
      let currentTotal = 0;
      let currentPa = null;

      const fetchCard = async (page) => {
        let query = supabase
          .from("player_artworks")
          .select(
            "*, artworks!inner(*, collections!artworks_collection_id_fkey(name)), players(username)",
            { count: "exact" },
          )
          .eq("player_id", playerId)
          .eq("artworks.status", "active");

        if (sub === "single_view") {
          const targetId = interaction.options.getInteger("id");
          query = query.eq("id", targetId);
        } else if (sub === "favorites_view") {
          query = query
            .eq("is_favorite", true)
            .order("id", { ascending: false });
        } else {
          query = query.order("id", { ascending: false });
        }

        if (sub !== "single_view") {
          const from = (page - 1) * 1;
          const to = from;
          query = query.range(from, to);
        }

        const { data, count, error } = await query;
        if (error) throw new Error("Fallo al contactar la base de datos.");

        currentTotal = count || 0;
        totalPages = Math.max(1, currentTotal);
        currentPa = data && data.length > 0 ? data[0] : null;

        return currentPa;
      };

      const buildActionRow = (pa) => {
        const row = new ActionRowBuilder();
        row.addComponents(
          new ButtonBuilder()
            .setCustomId("upg_level_1")
            .setLabel("+1 Nivel")
            .setStyle(ButtonStyle.Primary)
            .setEmoji("📈")
            .setDisabled(pa.level >= MAX_LEVEL_LIMIT),
          new ButtonBuilder()
            .setCustomId("upg_level_max")
            .setLabel("Max Nivel")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🚀")
            .setDisabled(pa.level >= MAX_LEVEL_LIMIT),
          new ButtonBuilder()
            .setCustomId("upg_stars_1")
            .setLabel("+1 Estrella")
            .setStyle(ButtonStyle.Success)
            .setEmoji("⭐")
            .setDisabled(pa.stars >= MAX_STARS_LIMIT),
          new ButtonBuilder()
            .setCustomId("upg_stars_max")
            .setLabel("Max Estrellas")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🌟")
            .setDisabled(pa.stars >= MAX_STARS_LIMIT),
        );
        return row;
      };

      const buildNavigationRow = (page, maxPages) => {
        const row = new ActionRowBuilder();
        if (page > 1)
          row.addComponents(
            new ButtonBuilder()
              .setCustomId("nav_prev")
              .setLabel("◀ Anterior")
              .setStyle(ButtonStyle.Primary),
          );
        if (maxPages > 2)
          row.addComponents(
            new ButtonBuilder()
              .setCustomId("nav_jump")
              .setLabel("Saltar a...")
              .setStyle(ButtonStyle.Secondary)
              .setEmoji("📄"),
          );
        if (page < maxPages)
          row.addComponents(
            new ButtonBuilder()
              .setCustomId("nav_next")
              .setLabel("Siguiente ▶")
              .setStyle(ButtonStyle.Primary),
          );
        return row;
      };

      const renderContent = async () => {
        if (!currentPa) {
          return {
            content:
              "❌ No se encontraron cartas que coincidan con tu búsqueda.",
            embeds: [],
            components: [],
          };
        }

        const art = currentPa.artworks;
        const rarityId = currentPa.rarity_id || art.rarity_id;
        const player = await economy.getPlayer(playerId);

        const { data: rc } = await supabase
          .from("rarity_configs")
          .select("base_ink_rate")
          .eq("collection_id", art.collection_id)
          .eq("rarity_id", rarityId)
          .maybeSingle();

        const baseRate = rc?.base_ink_rate || 0;
        const currentRate = Math.floor(
          calculateInkRate(
            baseRate,
            currentPa.stars,
            currentPa.level,
            currentPa.prestige_level || 0,
            gameModifiers,
          ),
        );

        let nextLevelCost = 0;
        if (currentPa.level < MAX_LEVEL_LIMIT) {
          nextLevelCost = calculateLevelUpgradeCost(
            currentPa.level,
            currentPa.level + 1,
            currentPa.prestige_level || 0,
            rarityId,
            ecoConfig,
          );
        }

        let nextStarCost = 0;
        if (currentPa.stars < MAX_STARS_LIMIT) {
          nextStarCost = calculateStarUpgradeCost(
            currentPa.stars,
            currentPa.stars + 1,
            currentPa.prestige_level || 0,
            rarityId,
            ecoConfig,
          );
        }

        const embed = buildArtworkEmbed(art, {
          playerArtwork: currentPa,
          ownerUsername: playerDisplayName,
          collectionName: art.collections?.name || "Desconocida",
          showVideoText: true,
        });

        const isGif = art.is_gif ?? /\.(gif)$/i.test(art.image_url);
        if (isGif) embed.setImage(art.image_url);

        let statsText = `💰 **Tu Saldo:** ${player.ink_dollars.toLocaleString()} Ink$ | 🌟 ${player.star_dust.toLocaleString()} Polvo\n`;
        statsText += `📈 **Generación actual:** ${currentRate.toLocaleString()} Ink$/h\n`;
        statsText +=
          currentPa.level < MAX_LEVEL_LIMIT
            ? `🔼 **Próximo Nivel:** ${nextLevelCost.toLocaleString()} Ink$\n`
            : `🔼 **Próximo Nivel:** LÍMITE ALCANZADO\n`;
        statsText +=
          currentPa.stars < MAX_STARS_LIMIT
            ? `⭐ **Próxima Estrella:** ${nextStarCost.toLocaleString()} Polvo\n\n`
            : `⭐ **Próxima Estrella:** LÍMITE ALCANZADO\n\n`;

        let counterText =
          sub === "single_view"
            ? `🔍 **Modo Inspección** | ID: ${currentPa.id}`
            : `📦 **Carta ${currentPage} de ${totalPages}** | Modo: ${sub === "favorites_view" ? "Favoritos" : "Inventario"}`;

        const counterEmbed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setDescription(statsText + counterText);

        const components = [buildActionRow(currentPa)];
        if (sub !== "single_view" && totalPages > 1)
          components.push(buildNavigationRow(currentPage, totalPages));

        return { content: "", embeds: [embed, counterEmbed], components };
      };

      await fetchCard(currentPage);
      if (!currentPa) {
        return interaction.editReply(
          "No se encontraron cartas. Si elegiste single_view, revisa el ID. Si elegiste favorites_view, asegúrate de tener favoritas.",
        );
      }

      const msg = await interaction.editReply(await renderContent());

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== playerId) {
          return i.reply({
            content: "❌ Solo el dueño de este menú puede usar los botones.",
            flags: MessageFlags.Ephemeral,
          });
        }

        if (!ActionManager.lockUser(i.user.id)) return;

        // 🛠️ Envolvemos toda la lógica de botones en un try-catch general para evitar Crashes Silenciosos
        try {
          // --- SALTO DE PÁGINA ---
          if (i.customId === "nav_jump") {
            const modal = new ModalBuilder()
              .setCustomId("modal_jump_upg")
              .setTitle("Saltar a Página");
            const pageInput = new TextInputBuilder()
              .setCustomId("input_page")
              .setLabel(`Página (1 - ${totalPages})`)
              .setStyle(TextInputStyle.Short)
              .setRequired(true);
            modal.addComponents(
              new ActionRowBuilder().addComponents(pageInput),
            );

            await i.showModal(modal);
            ActionManager.unlockUser(i.user.id);

            try {
              const submitted = await i.awaitModalSubmit({
                time: 30000,
                filter: (m) =>
                  m.user.id === playerId && m.customId === "modal_jump_upg",
              });
              const reqPage = parseInt(
                submitted.fields.getTextInputValue("input_page"),
              );
              if (isNaN(reqPage) || reqPage < 1 || reqPage > totalPages)
                return submitted.reply({
                  content: `❌ Página inválida.`,
                  flags: MessageFlags.Ephemeral,
                });

              if (!ActionManager.lockUser(submitted.user.id))
                return submitted.reply({
                  content: "⏳ Procesando...",
                  flags: MessageFlags.Ephemeral,
                });
              try {
                currentPage = reqPage;
                await fetchCard(currentPage);
                await submitted.update(await renderContent());
                collector.resetTimer();
              } finally {
                ActionManager.unlockUser(submitted.user.id);
              }
            } catch (e) {}
            return;
          }

          // --- MEJORAS MÁXIMAS CON VENTANA EMERGENTE ---
          if (
            i.customId === "upg_level_max" ||
            i.customId === "upg_stars_max"
          ) {
            const isLevel = i.customId === "upg_level_max";
            const rarityId =
              currentPa.rarity_id || currentPa.artworks.rarity_id;
            const player = await economy.getPlayer(playerId);

            let targetValue = isLevel ? currentPa.level : currentPa.stars;
            let totalCost = 0;
            const limit = isLevel ? MAX_LEVEL_LIMIT : MAX_STARS_LIMIT;

            if (targetValue >= limit) {
              await i.reply({
                content: `❌ Ya has alcanzado el límite máximo (${limit}).`,
                flags: MessageFlags.Ephemeral,
              });
              return;
            }

            let nextCumulative = isLevel
              ? calculateLevelUpgradeCost(
                  currentPa.level,
                  targetValue + 1,
                  currentPa.prestige_level || 0,
                  rarityId,
                  ecoConfig,
                )
              : calculateStarUpgradeCost(
                  currentPa.stars,
                  targetValue + 1,
                  currentPa.prestige_level || 0,
                  rarityId,
                  ecoConfig,
                );

            // 🛠️ Prevención de desbordamiento (Out of bounds)
            while (targetValue < limit) {
              const balance = isLevel ? player.ink_dollars : player.star_dust;
              if (balance >= nextCumulative) {
                targetValue++;
                totalCost = nextCumulative;
                // Solo calculamos el siguiente nivel si no hemos chocado contra el techo
                if (targetValue < limit) {
                  nextCumulative = isLevel
                    ? calculateLevelUpgradeCost(
                        currentPa.level,
                        targetValue + 1,
                        currentPa.prestige_level || 0,
                        rarityId,
                        ecoConfig,
                      )
                    : calculateStarUpgradeCost(
                        currentPa.stars,
                        targetValue + 1,
                        currentPa.prestige_level || 0,
                        rarityId,
                        ecoConfig,
                      );
                }
              } else {
                break;
              }
            }

            if (targetValue === (isLevel ? currentPa.level : currentPa.stars)) {
              await i.reply({
                content: `❌ No tienes suficientes fondos para subir más ${isLevel ? "niveles" : "estrellas"}.`,
                flags: MessageFlags.Ephemeral,
              });
              return;
            }

            const modal = new ModalBuilder()
              .setCustomId("modal_confirm_max")
              .setTitle(
                isLevel
                  ? `Subir +${targetValue - currentPa.level} Niveles`
                  : `Subir +${targetValue - currentPa.stars} Estrellas`,
              );

            const input = new TextInputBuilder()
              .setCustomId("input_confirm")
              .setLabel(
                `Costo: ${totalCost.toLocaleString()} ${isLevel ? "Ink$" : "Polvo"}. ¿Continuar?`,
              )
              .setPlaceholder("Presiona Enviar para confirmar gasto")
              .setStyle(TextInputStyle.Short)
              .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(input));

            await i.showModal(modal);
            ActionManager.unlockUser(i.user.id);

            try {
              const submitted = await i.awaitModalSubmit({
                time: 30000,
                filter: (m) =>
                  m.user.id === playerId && m.customId === "modal_confirm_max",
              });
              if (!ActionManager.lockUser(submitted.user.id))
                return submitted.reply({
                  content: "⏳ Procesando...",
                  flags: MessageFlags.Ephemeral,
                });

              try {
                await submitted.deferUpdate();
                if (isLevel)
                  await packService.upgradeLevel(
                    playerId,
                    currentPa.id,
                    targetValue,
                  );
                else
                  await packService.upgradeStars(
                    playerId,
                    currentPa.id,
                    targetValue,
                  );

                await fetchCard(currentPage);
                await interaction.editReply(await renderContent());
                collector.resetTimer();
              } finally {
                ActionManager.unlockUser(submitted.user.id);
              }
            } catch (e) {
              /* Modal ignorado */
            }
            return;
          }

          // --- NAVEGACIÓN SIMPLE ---
          if (i.customId === "nav_prev" || i.customId === "nav_next") {
            await i.deferUpdate();
            if (i.customId === "nav_prev") currentPage--;
            if (i.customId === "nav_next") currentPage++;

            await fetchCard(currentPage);
            await interaction.editReply(await renderContent());
            collector.resetTimer();
            return;
          }

          // --- MEJORAS SIMPLES (+1) ---
          await i.deferUpdate();
          const rarityId = currentPa.rarity_id || currentPa.artworks.rarity_id;

          if (i.customId === "upg_level_1") {
            await packService.upgradeLevel(
              playerId,
              currentPa.id,
              currentPa.level + 1,
            );
          } else if (i.customId === "upg_stars_1") {
            await packService.upgradeStars(
              playerId,
              currentPa.id,
              currentPa.stars + 1,
            );
          }

          await fetchCard(currentPage);
          await interaction.editReply(await renderContent());
          collector.resetTimer();
        } catch (error) {
          // 🛠️ Atrapamos cualquier error inesperado y se lo mostramos al usuario sin crashear el bot
          if (!i.replied && !i.deferred) {
            await i
              .reply({
                content: `❌ Error: ${error.message}`,
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
          } else {
            await i
              .followUp({
                content: `❌ Error: ${error.message}`,
                flags: MessageFlags.Ephemeral,
              })
              .catch(() => {});
          }
        } finally {
          ActionManager.unlockUser(i.user.id);
        }
      });

      collector.on("end", () => {
        interaction.editReply({ components: [] }).catch(() => {});
      });
    } catch (err) {
      console.error("[Upgrade UI]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
