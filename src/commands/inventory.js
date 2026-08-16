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
} = require("discord.js");
const economy = require("../services/economy");
const gallery = require("../services/gallery");
const { buildArtworkEmbed } = require("../utils/embeds");
const { formatCardText } = require("../utils/cardFormat"); // 🛠️ Importamos el formateador

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

        // 🛠️ Botón de salto SOLO si hay más de 2 páginas en total
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
        const startIndex = (page - 1) * perPage; // 🛠️ Para enumeración absoluta

        if (sub === "list") {
          // 🛠️ Aplicamos el formato Detailed
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
          const isVid =
            item.artworks?.image_url &&
            item.artworks.image_url.match(/\.(mp4|webm)$/i);

          const embed = buildArtworkEmbed(item.artworks, {
            playerArtwork: item,
            ownerUsername: targetUser.username,
            collectionName: item.artworks.collections?.name || "Desconocida",
            showVideoText: isVid ? true : false,
          });

          const counterEmbed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setDescription(
              `📦 **Carta ${page} de ${maxPages}** — (${totalItems} en total) | Orden: ${sortBy}`,
            );

          payload.embeds.push(embed, counterEmbed);
          payload.components.push(
            buildNavigationRow(page, maxPages, true, isVid),
          );
          return payload;
        } else if (sub === "binder") {
          const fakeUrl = `https://discord.com/binder/${targetUser.id}/${page}`;

          // 🛠️ Aplicamos el formato Intermediate con enumeración
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
            .setImage(
              pageItems[0].artworks.sample_url ||
                pageItems[0].artworks.image_url,
            );

          payload.embeds.push(mainEmbed);

          for (let idx = 1; idx < pageItems.length; idx++) {
            const extraEmbed = new EmbedBuilder()
              .setURL(fakeUrl)
              .setImage(
                pageItems[idx].artworks.sample_url ||
                  pageItems[idx].artworks.image_url,
              );
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

        if (i.customId === "nav_prev" || i.customId === "nav_next") {
          await i.deferUpdate();
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

          // 🛠️ Aprovechamos el formato minimalista para la información del video
          const headerInfo = `🎥 ` + formatCardText(card, "minimalist");

          const updatedRow = new ActionRowBuilder();
          i.message.components[0].components.forEach((btn) => {
            const newBtn = ButtonBuilder.from(btn);
            if (btn.customId === "nav_video") newBtn.setDisabled(true);
            updatedRow.addComponents(newBtn);
          });

          await i.update({
            content: `[${headerInfo}](${rawVideoUrl})`,
            embeds: [],
            components: [updatedRow],
          });
          collector.resetTimer();
        }

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
                ephemeral: true,
              });
              return;
            }

            currentPage = reqPage;
            const { items: newItems, total: newTotal } =
              await fetchPage(currentPage);
            await submitted.update(
              renderContent(newItems, currentPage, totalPages, newTotal),
            );
            collector.resetTimer();
          } catch (e) {}
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
