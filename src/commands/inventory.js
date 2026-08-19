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
const economy = require("../services/economy");
const gallery = require("../services/gallery");
const { buildArtworkEmbed } = require("../utils/embeds");
const { formatCardText } = require("../utils/cardFormat");
const ActionManager = require("../utils/ActionManager"); // 🛠️ Importamos el gestor anti-spam

// 🛠️ Helper para seleccionar la URL correcta según si es GIF o imagen/video
const getCardImageUrl = (art) => {
  const isGif = art.is_gif ?? /\.(gif)$/i.test(art.image_url);
  return isGif ? art.image_url : art.sample_url || art.image_url;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("Visualiza y gestiona tu colección de cartas")
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("Muestra un listado resumido de tu inventario")
        .addUserOption((opt) =>
          opt
            .setName("usuario")
            .setDescription("Usuario a inspeccionar")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("orden")
            .setDescription("Filtro para ordenar tus cartas")
            .addChoices(
              { name: "🕒 Más recientes (Por defecto)", value: "recent" },
              { name: "⭐ Mejores cartas (Generadoras)", value: "power" },
              { name: "🔤 Agrupar Duplicados (Nombre)", value: "name" },
              { name: "✨ Rareza (Mayor a Menor)", value: "rarity" },
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("Inspecciona los detalles de tus cartas una por una")
        .addUserOption((opt) =>
          opt
            .setName("usuario")
            .setDescription("Usuario a inspeccionar")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("orden")
            .setDescription("Filtro para ordenar tus cartas")
            .addChoices(
              { name: "🕒 Más recientes (Por defecto)", value: "recent" },
              { name: "⭐ Mejores cartas (Generadoras)", value: "power" },
              { name: "🔤 Agrupar Duplicados (Nombre)", value: "name" },
              { name: "✨ Rareza (Mayor a Menor)", value: "rarity" },
            )
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("binder")
        .setDescription("Abre tu álbum para ver una cuadrícula de tus cartas")
        .addUserOption((opt) =>
          opt
            .setName("usuario")
            .setDescription("Usuario a inspeccionar")
            .setRequired(false),
        )
        .addStringOption((opt) =>
          opt
            .setName("orden")
            .setDescription("Filtro para ordenar tus cartas")
            .addChoices(
              { name: "🕒 Más recientes (Por defecto)", value: "recent" },
              { name: "⭐ Mejores cartas (Generadoras)", value: "power" },
              { name: "🔤 Agrupar Duplicados (Nombre)", value: "name" },
              { name: "✨ Rareza (Mayor a Menor)", value: "rarity" },
            )
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const sub = interaction.options.getSubcommand();
      const targetUser =
        interaction.options.getUser("usuario") || interaction.user;
      const sortBy = interaction.options.getString("orden") || "recent";

      let currentPage = 1;
      let perPage = sub === "list" ? 10 : sub === "binder" ? 4 : 1;

      await economy.getOrCreatePlayer(targetUser.id, targetUser.username);

      const fetchPage = async (page) => {
        return await gallery.getInventory(targetUser.id, page, perPage, sortBy);
      };

      const buildNavigationRow = (
        page,
        maxPages,
        isViewMode = false,
        isVideoCard = false,
      ) => {
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

        if (isViewMode && isVideoCard) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId("nav_video")
              .setLabel("Ver Video")
              .setStyle(ButtonStyle.Success)
              .setEmoji("▶️"),
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

      const { items: initialItems, total: initialTotal } =
        await fetchPage(currentPage);

      if (!initialItems.length) {
        const msg =
          targetUser.id === interaction.user.id
            ? "Tu inventario está vacío. ¡Abre un sobre con `/pack`!"
            : `El inventario de **${targetUser.username}** está vacío.`;
        return interaction.editReply({ content: msg });
      }

      let totalPages = Math.max(1, Math.ceil(initialTotal / perPage));

      const renderContent = (pageItems, page, maxPages, totalItems) => {
        const payload = { content: "", embeds: [], components: [] };
        const startIndex = (page - 1) * perPage;

        if (sub === "list") {
          const desc = pageItems
            .map((item, idx) =>
              formatCardText(item, "detailed", startIndex + idx + 1),
            )
            .join("\n");

          const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle(`🎒 Inventario de ${targetUser.username}`)
            .setDescription(desc)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setFooter({
              text: `Página ${page}/${maxPages} | Total: ${totalItems} cartas | Orden: ${sortBy}`,
            });

          payload.embeds.push(embed);
        } else if (sub === "view") {
          const item = pageItems[0];
          const art = item.artworks;
          const isVid = art.is_video ?? /\.(mp4|webm)$/i.test(art.image_url);
          const isGif = art.is_gif ?? /\.(gif)$/i.test(art.image_url);

          const embed = buildArtworkEmbed(art, {
            playerArtwork: item,
            ownerUsername: targetUser.username,
            collectionName: art.collections?.name || "Desconocida",
            showVideoText: isVid ? true : false,
          });

          // 🛠️ Ajuste de URL si es GIF animado
          if (isGif) {
            embed.setImage(art.image_url);
          }

          let counterText = `📦 **Carta ${page} de ${maxPages}** — (${totalItems} en total) | Orden: ${sortBy}`;
          if (isGif)
            counterText +=
              "\n*💡 Nota: Los GIFs pueden tardar unos segundos en cargar.*";

          const counterEmbed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setDescription(counterText);

          payload.embeds.push(embed, counterEmbed);
          payload.components.push(
            buildNavigationRow(page, maxPages, true, isVid),
          );
          return payload;
        } else if (sub === "binder") {
          const fakeUrl = `https://discord.com/binder/${targetUser.id}/${page}`;
          const desc = pageItems
            .map((item, idx) =>
              formatCardText(item, "intermediate", startIndex + idx + 1),
            )
            .join("\n\n");

          const mainEmbed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(`📁 Álbum de ${targetUser.username}`)
            .setDescription(
              `**Página ${page}/${maxPages}** | Orden: ${sortBy}\n\n${desc}`,
            )
            .setURL(fakeUrl)
            .setImage(getCardImageUrl(pageItems[0].artworks));

          payload.embeds.push(mainEmbed);

          for (let idx = 1; idx < pageItems.length; idx++) {
            const extraEmbed = new EmbedBuilder()
              .setURL(fakeUrl)
              .setImage(getCardImageUrl(pageItems[idx].artworks));
            payload.embeds.push(extraEmbed);
          }
        }

        const row = buildNavigationRow(page, maxPages);
        if (row.components.length > 0) payload.components.push(row);

        return payload;
      };

      const msg = await interaction.editReply(
        renderContent(initialItems, currentPage, totalPages, initialTotal),
      );

      const collector = msg.createMessageComponentCollector({
        time: 120000,
        filter: (i) => i.user.id === interaction.user.id,
      });

      collector.on("collect", async (i) => {
        if (i.isModalSubmit()) return;

        // --- MANEJO DE MODAL (SALTAR PÁGINA) ---
        if (i.customId === "nav_jump") {
          const modal = new ModalBuilder()
            .setCustomId("modal_jump_page")
            .setTitle("Saltar a Página");

          const pageInput = new TextInputBuilder()
            .setCustomId("input_page")
            .setLabel(`Página (1 - ${totalPages})`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(pageInput));
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
              await submitted.reply({
                content: `❌ Página inválida. Debe ser un número entre 1 y ${totalPages}.`,
                flags: MessageFlags.Ephemeral,
              });
              return;
            }

            if (!ActionManager.lockUser(submitted.user.id)) {
              await submitted.reply({
                content: "⏳ Procesando tu acción, por favor espera...",
                flags: MessageFlags.Ephemeral,
              });
              return;
            }

            try {
              currentPage = reqPage;
              const { items: newItems, total: newTotal } =
                await fetchPage(currentPage);
              await submitted.update(
                renderContent(newItems, currentPage, totalPages, newTotal),
              );
              collector.resetTimer();
            } finally {
              ActionManager.unlockUser(submitted.user.id);
            }
          } catch (e) {}
          return;
        }

        // --- BOTONES DE NAVEGACIÓN ESTÁNDAR ---
        await i.deferUpdate();

        if (!ActionManager.lockUser(i.user.id)) {
          return i.followUp({
            content: "⏳ Procesando tu acción, por favor espera...",
            flags: MessageFlags.Ephemeral,
          });
        }

        try {
          // Deshabilitar botones temporalmente durante el fetch
          const disabledRows = i.message.components.map((row) => {
            const newRow = new ActionRowBuilder();
            row.components.forEach((btn) => {
              newRow.addComponents(ButtonBuilder.from(btn).setDisabled(true));
            });
            return newRow;
          });
          await interaction.editReply({ components: disabledRows });

          if (i.customId === "nav_prev" || i.customId === "nav_next") {
            if (i.customId === "nav_prev") currentPage--;
            if (i.customId === "nav_next") currentPage++;

            const { items: newItems, total: newTotal } =
              await fetchPage(currentPage);
            totalPages = Math.max(1, Math.ceil(newTotal / perPage));
            await interaction.editReply(
              renderContent(newItems, currentPage, totalPages, newTotal),
            );
            collector.resetTimer();
          }

          if (i.customId === "nav_video") {
            const { items: currentItems } = await fetchPage(currentPage);
            const card = currentItems[0];
            const rawVideoUrl = card.artworks.image_url;
            const headerInfo = `🎥 ` + formatCardText(card, "minimalist");

            const updatedRow = new ActionRowBuilder();
            i.message.components[0].components.forEach((btn) => {
              const newBtn = ButtonBuilder.from(btn);
              if (btn.customId === "nav_video") newBtn.setDisabled(true);
              updatedRow.addComponents(newBtn);
            });

            await interaction.editReply({
              content: `[${headerInfo}](${rawVideoUrl})`,
              embeds: [],
              components: [updatedRow],
            });
            collector.resetTimer();
          }
        } finally {
          ActionManager.unlockUser(i.user.id);
        }
      });

      collector.on("end", () => {
        interaction.editReply({ components: [] }).catch(() => {});
      });
    } catch (err) {
      console.error("[Inventory]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
