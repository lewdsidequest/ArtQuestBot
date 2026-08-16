const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const economy = require("../services/economy");
const gallery = require("../services/gallery");
const packService = require("../services/pack");
const supabase = require("../database/supabase");
const { buildArtworkEmbed } = require("../utils/embeds");
const RarityManager = require("../utils/rarity");
const { formatCardText } = require("../utils/cardFormat");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("favorite")
    .setDescription("Gestiona y visualiza tus cartas favoritas")
    .addSubcommand((sub) =>
      sub
        .setName("toggle")
        .setDescription("Marca o desmarca un artwork como favorito")
        .addIntegerOption((opt) =>
          opt
            .setName("id")
            .setDescription("ID del artwork en tu inventario")
            .setRequired(true)
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove_all")
        .setDescription("Quita el estado de favorito de TODAS tus cartas"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("cards")
        .setDescription("Mira tus cartas favoritas una por una a todo detalle")
        .addUserOption((opt) =>
          opt
            .setName("usuario")
            .setDescription("Ver los favoritos de otro jugador")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("binder")
        .setDescription(
          "Abre tu álbum para ver una cuadrícula de tus favoritos",
        )
        .addUserOption((opt) =>
          opt
            .setName("usuario")
            .setDescription("Ver el álbum de otro jugador")
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "toggle" || sub === "remove_all") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferReply();
    }

    try {
      if (sub === "remove_all") {
        const { error } = await supabase
          .from("player_artworks")
          .update({ is_favorite: false })
          .eq("player_id", interaction.user.id)
          .eq("is_favorite", true);
        if (error) throw new Error("No se pudieron limpiar tus favoritos.");
        return interaction.editReply({
          content:
            "🗑️ **Listo:** Se ha quitado la marca de favorito a todas tus cartas.",
        });
      }

      if (sub === "toggle") {
        await economy.getOrCreatePlayer(
          interaction.user.id,
          interaction.user.username,
        );
        const paId = interaction.options.getInteger("id");
        const pa = await gallery.getPlayerArtwork(interaction.user.id, paId);

        if (!pa)
          return interaction.editReply({
            content: "❌ Artwork no encontrado en tu inventario.",
          });

        const isFav = await packService.toggleFavorite(
          interaction.user.id,
          paId,
        );
        return interaction.editReply({
          content: isFav
            ? `💎 **${pa.artworks.name}** ahora es un favorito.`
            : `**${pa.artworks.name}** ya no es favorito.`,
        });
      }

      const targetUser =
        interaction.options.getUser("usuario") || interaction.user;
      await economy.getOrCreatePlayer(targetUser.id, targetUser.username);

      const { data: favorites, error } = await supabase
        .from("player_artworks")
        .select("*, artworks(*, collections!artworks_collection_id_fkey(name))")
        .eq("player_id", targetUser.id)
        .eq("is_favorite", true)
        .order("level", { ascending: false })
        .order("stars", { ascending: false });

      if (error) throw new Error("No se pudieron cargar los favoritos.");

      if (!favorites || favorites.length === 0) {
        const msg =
          targetUser.id === interaction.user.id
            ? "💔 Aún no tienes ninguna carta favorita. Usa `/favorite toggle` para marcar una."
            : `💔 **${targetUser.username}** no tiene cartas favoritas.`;
        return interaction.editReply({ content: msg });
      }

      if (sub === "cards") {
        let currentIndex = 0;
        const total = favorites.length;

        const updateCardView = async (index, i = null) => {
          const card = favorites[index];
          const embed = buildArtworkEmbed(card.artworks, {
            playerArtwork: card,
            ownerUsername: targetUser.username,
            collectionName: card.artworks.collections?.name || "Desconocida",
            showVideoText: true,
          });

          const decoration =
            "╔═══ ⋆⋅☆⋅⋆ ═══╗\n~✨ **Mi Favorita** ✨\n╚═══ ⋆⋅☆⋅⋆ ═══╝\n";
          embed.setDescription(
            `${decoration}\n${embed.data.description || ""}`,
          );

          const counterEmbed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setDescription(`⭐ **Favorito ${index + 1} de ${total}**`);
          const row = new ActionRowBuilder();

          if (index > 0)
            row.addComponents(
              new ButtonBuilder()
                .setCustomId("fav_prev")
                .setLabel("◀ Anterior")
                .setStyle(ButtonStyle.Secondary),
            );

          if (
            card.artworks.image_url &&
            card.artworks.image_url.match(/\.(mp4|webm)$/i)
          ) {
            row.addComponents(
              new ButtonBuilder()
                .setCustomId("fav_video")
                .setLabel("Ver Video")
                .setStyle(ButtonStyle.Primary)
                .setEmoji("▶️"),
            );
          }
          if (index < total - 1)
            row.addComponents(
              new ButtonBuilder()
                .setCustomId("fav_next")
                .setLabel("Siguiente ▶")
                .setStyle(ButtonStyle.Secondary),
            );

          const payload = {
            content: "",
            embeds: [embed, counterEmbed],
            components: row.components.length ? [row] : [],
          };
          if (i) await i.update(payload);
          else await interaction.editReply(payload);
        };

        await updateCardView(currentIndex);

        const collector = (
          await interaction.fetchReply()
        ).createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 120000,
          filter: (i) => i.user.id === interaction.user.id,
        });

        collector.on("collect", async (i) => {
          if (i.customId === "fav_prev") {
            currentIndex--;
            await updateCardView(currentIndex, i);
          } else if (i.customId === "fav_next") {
            currentIndex++;
            await updateCardView(currentIndex, i);
          } else if (i.customId === "fav_video") {
            const card = favorites[currentIndex];
            const rawVideoUrl = card.artworks.image_url;
            const rarityData = RarityManager.get(card.artworks.rarity_id);
            const headerInfo = `🎥 **${card.artworks.name} (ID: ${card.id}) | ⭐${card.stars} | Nv.${card.level} | ${rarityData?.name || "Unknown"}**`;

            const updatedRow = new ActionRowBuilder();
            i.message.components[0].components.forEach((btn) => {
              const newBtn = ButtonBuilder.from(btn);
              if (btn.customId === "fav_video") newBtn.setDisabled(true);
              updatedRow.addComponents(newBtn);
            });

            await i.update({
              content: `[${headerInfo}](${rawVideoUrl})`,
              embeds: [],
              components: [updatedRow],
            });
          }
        });

        collector.on("end", () =>
          interaction.editReply({ components: [] }).catch(() => {}),
        );
        return;
      }

      if (sub === "binder") {
        const perPage = 4;
        let currentPage = 1;
        const totalPages = Math.ceil(favorites.length / perPage);

        const updateBinderView = async (page, i = null) => {
          const from = (page - 1) * perPage;
          const to = from + perPage;
          const pageItems = favorites.slice(from, to);
          const fakeUrl = `https://discord.com/binder/${targetUser.id}/${page}`;
          const embeds = [];

          const startIndex = (page - 1) * perPage;

          // Aplicamos el formato Intermediate enumerado
          const desc = pageItems
            .map((item, idx) => {
              return formatCardText(item, "intermediate", startIndex + idx + 1);
            })
            .join("\n\n");

          const mainEmbed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(`📁 Álbum de Favoritos de ${targetUser.username}`)
            .setDescription(`**Página ${page}/${totalPages}**\n\n${desc}`)
            .setURL(fakeUrl)
            // Usa sample_url prioritariamente para el Thumbnail si es video
            .setImage(
              pageItems[0].artworks.sample_url ||
                pageItems[0].artworks.image_url,
            );

          embeds.push(mainEmbed);

          for (let idx = 1; idx < pageItems.length; idx++) {
            const extraEmbed = new EmbedBuilder()
              .setURL(fakeUrl)
              // Usa sample_url aquí también
              .setImage(
                pageItems[idx].artworks.sample_url ||
                  pageItems[idx].artworks.image_url,
              );
            embeds.push(extraEmbed);
          }

          const row = new ActionRowBuilder();
          if (page > 1)
            row.addComponents(
              new ButtonBuilder()
                .setCustomId("bin_prev")
                .setLabel("◀ Página")
                .setStyle(ButtonStyle.Primary),
            );
          if (page < totalPages)
            row.addComponents(
              new ButtonBuilder()
                .setCustomId("bin_next")
                .setLabel("Página ▶")
                .setStyle(ButtonStyle.Primary),
            );

          const payload = {
            content: "",
            embeds,
            components: row.components.length ? [row] : [],
          };
          if (i) await i.update(payload);
          else await interaction.editReply(payload);
        };

        await updateBinderView(currentPage);

        const collector = (
          await interaction.fetchReply()
        ).createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 120000,
          filter: (i) => i.user.id === interaction.user.id,
        });

        collector.on("collect", async (i) => {
          if (i.customId === "bin_prev") currentPage--;
          if (i.customId === "bin_next") currentPage++;
          await updateBinderView(currentPage, i);
        });

        collector.on("end", () =>
          interaction.editReply({ components: [] }).catch(() => {}),
        );
        return;
      }
    } catch (err) {
      console.error("[Favorite]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
