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
const ActionManager = require("../utils/ActionManager");
const supabase = require("../database/supabase");

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
            .setDescription("IDs separados por comas o espacios")
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
            .setDescription("IDs separados por comas o espacios")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove_all")
        .setDescription(
          "Limpia TODA tu lista de favoritos (Requiere confirmación)",
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

      await economy.getOrCreatePlayer(playerId, targetUser.displayName);

      // ==========================================
      // LÓGICA DE REMOVE ALL
      // ==========================================
      if (sub === "remove_all") {
        if (targetUser.id !== interaction.user.id) {
          return interaction.editReply(
            "❌ Solo puedes modificar tus propios favoritos.",
          );
        }

        const confirmEmbed = new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle("⚠️ Confirmar Limpieza Total")
          .setDescription(
            "¿Estás seguro de que deseas quitar **TODAS** tus cartas de la lista de favoritos? Esta acción no destruye las cartas, pero dejarán de estar protegidas.",
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("fav_clear_confirm")
            .setLabel("Sí, limpiar favoritos")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("🗑️"),
          new ButtonBuilder()
            .setCustomId("fav_clear_cancel")
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
          await i.deferUpdate();

          if (!ActionManager.lockUser(i.user.id)) return;

          try {
            const disabledRow = new ActionRowBuilder().addComponents(
              ButtonBuilder.from(
                i.message.components[0].components[0],
              ).setDisabled(true),
              ButtonBuilder.from(
                i.message.components[0].components[1],
              ).setDisabled(true),
            );
            await interaction.editReply({ components: [disabledRow] });

            if (i.customId === "fav_clear_cancel") {
              return interaction.editReply({
                content: "🚫 Operación cancelada. Tus favoritos están a salvo.",
                embeds: [],
                components: [],
              });
            }

            if (i.customId === "fav_clear_confirm") {
              const { error } = await supabase
                .from("player_artworks")
                .update({ is_favorite: false })
                .eq("player_id", playerId)
                .eq("is_favorite", true);

              if (error)
                throw new Error("Fallo al actualizar la base de datos.");

              const successEmbed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setDescription(
                  "✅ Tu lista de favoritos ha sido limpiada por completo.",
                );
              await interaction.editReply({
                embeds: [successEmbed],
                components: [],
              });
            }
          } catch (e) {
            await interaction.editReply({
              content: `❌ Error: ${e.message}`,
              embeds: [],
              components: [],
            });
          } finally {
            ActionManager.unlockUser(i.user.id);
            collector.stop();
          }
        });

        collector.on("end", async (collected, reason) => {
          if (reason === "time")
            interaction.editReply({ components: [] }).catch(() => {});
        });
        return;
      }

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

        if (uniqueIds.length === 0)
          return interaction.editReply(
            "❌ No proporcionaste ningún ID numérico válido. Ejemplo: `12, 45`",
          );
        if (uniqueIds.length > 20)
          return interaction.editReply(
            "❌ Por favor, actualiza un máximo de 20 cartas a la vez.",
          );

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
            text: `⚠️ ${ignoredCount} ID(s) ignorados (no existen o no te pertenecen).`,
          });
        }

        return interaction.editReply({ embeds: [embed] });
      }

      // ==========================================
      // LÓGICA DE BINDER
      // ==========================================
      if (sub === "binder") {
        let currentPage = 1;
        const perPage = 4;

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
              ? "No tienes ninguna carta marcada como favorita. Usa `/favorite add [id]`."
              : `**${targetUser.displayName}** no tiene cartas favoritas.`;
          return interaction.editReply({ content: msg });
        }

        let totalPages = Math.max(1, Math.ceil(initialTotal / perPage));

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
            .setTitle(`💎 Favoritos de ${targetUser.displayName}`)
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

              if (isNaN(reqPage) || reqPage < 1 || reqPage > totalPages)
                return submitted.reply({
                  content: `❌ Página inválida.`,
                  ephemeral: true,
                });
              if (!ActionManager.lockUser(i.user.id)) return;

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

          await i.deferUpdate();
          if (!ActionManager.lockUser(i.user.id)) return;

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
