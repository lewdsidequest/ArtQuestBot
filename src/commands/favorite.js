const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const economy = require("../services/economy");
const packService = require("../services/pack");
const { formatCardText } = require("../utils/cardFormat");
const ActionManager = require("../utils/ActionManager"); // 🛠️ Anti-spam
const supabase = require("../database/supabase");

// 🛠️ Helper para GIFs y Videos
const getCardImageUrl = (art) => {
  const isGif = art.is_gif ?? /\.(gif)$/i.test(art.image_url);
  return isGif ? art.image_url : art.sample_url || art.image_url;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("favorite")
    .setDescription("Gestiona y visualiza tus cartas favoritas")
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
    )
    .addSubcommand((sub) =>
      sub
        .setName("binder")
        .setDescription("Abre tu álbum de cartas favoritas")
        .addUserOption((opt) =>
          opt
            .setName("usuario")
            .setDescription("Usuario a inspeccionar")
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();
    try {
      const sub = interaction.options.getSubcommand();
      const targetUser =
        interaction.options.getUser("usuario") || interaction.user;
      const playerId = targetUser.id;

      await economy.getOrCreatePlayer(playerId, targetUser.username);

      // ==========================================
      // LÓGICA DE ADD / REMOVE
      // ==========================================
      if (sub === "add" || sub === "remove") {
        if (targetUser.id !== interaction.user.id) {
          return interaction.editReply(
            "❌ Solo puedes modificar tus propios favoritos.",
          );
        }

        const idsString = interaction.options.getString("ids");
        const rawIds = idsString
          .split(/[,\s]+/)
          .map(Number)
          .filter((n) => !isNaN(n) && n > 0);
        const uniqueIds = [...new Set(rawIds)];

        if (uniqueIds.length === 0) {
          return interaction.editReply(
            "❌ No proporcionaste ningún ID numérico válido. Ejemplo de uso: `12, 45, 102`",
          );
        }

        if (uniqueIds.length > 20) {
          return interaction.editReply(
            "❌ Por favor, actualiza un máximo de 20 cartas a la vez.",
          );
        }

        const isAdding = sub === "add";
        const affectedCards = await packService.setFavorites(
          playerId,
          uniqueIds,
          isAdding,
        );

        const cardsText = affectedCards
          .map((card) => formatCardText(card, "minimalist"))
          .join("\n");

        const embed = new EmbedBuilder()
          .setColor(isAdding ? 0xf1c40f : 0x95a5a6)
          .setTitle(
            isAdding ? "💎 Añadidas a Favoritos" : "🗑️ Removidas de Favoritos",
          )
          .setDescription(
            `Se han actualizado **${affectedCards.length}** cartas:\n\n${cardsText || "Ninguna carta válida encontrada."}`,
          );

        if (affectedCards.length < uniqueIds.length) {
          const ignoredCount = uniqueIds.length - affectedCards.length;
          embed.setFooter({
            text: `⚠️ ${ignoredCount} ID(s) fueron ignorados (no existen o no te pertenecen).`,
          });
        }

        return interaction.editReply({ embeds: [embed] });
      }

      // ==========================================
      // LÓGICA DE BINDER (VISUALIZACIÓN)
      // ==========================================
      if (sub === "binder") {
        let currentPage = 1;
        const perPage = 4;

        // Extraemos las favoritas ordenadas por las más recientes
        const fetchPage = async (page) => {
          const from = (page - 1) * perPage;
          const to = from + perPage - 1;
          const { data, count, error } = await supabase
            .from("player_artworks")
            .select("*, artworks(*)", { count: "exact" })
            .eq("player_id", playerId)
            .eq("is_favorite", true)
            .order("id", { ascending: false })
            .range(from, to);

          if (error) throw new Error("Error al consultar tus favoritos.");
          return { items: data || [], total: count || 0 };
        };

        const { items: initialItems, total: initialTotal } =
          await fetchPage(currentPage);

        if (!initialItems.length) {
          const msg =
            playerId === interaction.user.id
              ? "No tienes ninguna carta marcada como favorita actualmente. Usa `/favorite add [id]`."
              : `**${targetUser.username}** no tiene cartas favoritas públicas.`;
          return interaction.editReply({ content: msg });
        }

        let totalPages = Math.max(1, Math.ceil(initialTotal / perPage));

        const buildNavigationRow = (page, maxPages) => {
          const row = new ActionRowBuilder();
          if (page > 1) {
            row.addComponents(
              new ButtonBuilder()
                .setCustomId("nav_prev")
                .setLabel("◀ Anterior")
                .setStyle(ButtonStyle.Primary),
            );
          }
          if (maxPages > 2) {
            row.addComponents(
              new ButtonBuilder()
                .setCustomId("nav_jump")
                .setLabel("Saltar a...")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("📄"),
            );
          }
          if (page < maxPages) {
            row.addComponents(
              new ButtonBuilder()
                .setCustomId("nav_next")
                .setLabel("Siguiente ▶")
                .setStyle(ButtonStyle.Primary),
            );
          }
          return row;
        };

        const renderContent = (pageItems, page, maxPages) => {
          const payload = { content: "", embeds: [], components: [] };
          const startIndex = (page - 1) * perPage;
          const fakeUrl = `https://discord.com/binder/${playerId}/${page}`;

          const desc = pageItems
            .map((item, idx) =>
              formatCardText(item, "intermediate", startIndex + idx + 1),
            )
            .join("\n\n");

          const mainEmbed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(`💎 Favoritos de ${targetUser.username}`)
            .setDescription(`**Página ${page}/${maxPages}**\n\n${desc}`)
            .setURL(fakeUrl)
            .setImage(getCardImageUrl(pageItems[0].artworks));

          payload.embeds.push(mainEmbed);

          for (let idx = 1; idx < pageItems.length; idx++) {
            const extraEmbed = new EmbedBuilder()
              .setURL(fakeUrl)
              .setImage(getCardImageUrl(pageItems[idx].artworks));
            payload.embeds.push(extraEmbed);
          }

          const row = buildNavigationRow(page, maxPages);
          if (row.components.length > 0) payload.components.push(row);

          return payload;
        };

        const msg = await interaction.editReply(
          renderContent(initialItems, currentPage, totalPages),
        );

        const collector = msg.createMessageComponentCollector({
          time: 120000,
          filter: (i) => i.user.id === interaction.user.id,
        });

        collector.on("collect", async (i) => {
          if (i.isModalSubmit()) return;

          // --- SALTO DE PÁGINA ---
          if (i.customId === "nav_jump") {
            const modal = new ModalBuilder()
              .setCustomId("modal_jump_page")
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

            try {
              const submitted = await i.awaitModalSubmit({
                time: 30000,
                filter: (m) =>
                  m.user.id === interaction.user.id &&
                  m.customId === "modal_jump_page",
              });

              const reqPage = parseInt(
                submitted.fields.getTextInputValue("input_page"),
              );
              if (isNaN(reqPage) || reqPage < 1 || reqPage > totalPages) {
                return submitted.reply({
                  content: `❌ Página inválida. Debe ser un número entre 1 y ${totalPages}.`,
                  ephemeral: true,
                });
              }

              if (!ActionManager.lockUser(submitted.user.id)) {
                return submitted.reply({
                  content: "⏳ Procesando tu acción...",
                  ephemeral: true,
                });
              }

              try {
                currentPage = reqPage;
                const { items: newItems } = await fetchPage(currentPage);
                await submitted.update(
                  renderContent(newItems, currentPage, totalPages),
                );
                collector.resetTimer();
              } finally {
                ActionManager.unlockUser(submitted.user.id);
              }
            } catch (e) {}
            return;
          }

          // --- PAGINACIÓN NORMAL ---
          await i.deferUpdate();

          if (!ActionManager.lockUser(i.user.id)) {
            return i.followUp({
              content: "⏳ Procesando tu acción, por favor espera...",
              ephemeral: true,
            });
          }

          try {
            const disabledRows = i.message.components.map((row) => {
              const newRow = new ActionRowBuilder();
              row.components.forEach((btn) =>
                newRow.addComponents(ButtonBuilder.from(btn).setDisabled(true)),
              );
              return newRow;
            });
            await interaction.editReply({ components: disabledRows });

            if (i.customId === "nav_prev") currentPage--;
            if (i.customId === "nav_next") currentPage++;

            const { items: newItems, total: newTotal } =
              await fetchPage(currentPage);
            totalPages = Math.max(1, Math.ceil(newTotal / perPage));

            await interaction.editReply(
              renderContent(newItems, currentPage, totalPages),
            );
            collector.resetTimer();
          } finally {
            ActionManager.unlockUser(i.user.id);
          }
        });

        collector.on("end", () => {
          interaction.editReply({ components: [] }).catch(() => {});
        });
      }
    } catch (error) {
      console.error("[Favorite]", error);
      await interaction.editReply(
        `❌ Error al gestionar favoritos: ${error.message}`,
      );
    }
  },
};
