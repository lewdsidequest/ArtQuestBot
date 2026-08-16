const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const economy = require("../services/economy");
const packService = require("../services/pack");
const {
  calculateLevelUpgradeCost,
  calculateStarUpgradeCost,
} = require("../utils/power");
const supabase = require("../database/supabase");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("upgrade")
    .setDescription("Mejora un artwork de tu inventario")
    .addSubcommand((sub) =>
      sub
        .setName("level")
        .setDescription("Sube de nivel un artwork (cuesta Ink Dollars)")
        .addIntegerOption((opt) =>
          opt
            .setName("id")
            .setDescription("ID del artwork en tu inventario")
            .setRequired(true)
            .setMinValue(1),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("cantidad")
            .setDescription("Cuántos niveles subir de golpe")
            .setRequired(false)
            .setMinValue(1),
        )
        .addBooleanOption((opt) =>
          opt
            .setName("maximo")
            .setDescription("Sube el máximo de niveles que tu dinero permita")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("stars")
        .setDescription("Aumenta estrellas con Polvo de Estrella")
        .addIntegerOption((opt) =>
          opt
            .setName("id")
            .setDescription("ID del artwork en tu inventario")
            .setRequired(true)
            .setMinValue(1),
        )
        .addIntegerOption((opt) =>
          opt
            .setName("cantidad")
            .setDescription("Cuántas estrellas subir de golpe")
            .setRequired(false)
            .setMinValue(1),
        )
        .addBooleanOption((opt) =>
          opt
            .setName("maximo")
            .setDescription("Sube el máximo de estrellas que tu polvo permita")
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const player = await economy.getOrCreatePlayer(
        interaction.user.id,
        interaction.user.username,
      );
      const sub = interaction.options.getSubcommand();
      const paId = interaction.options.getInteger("id");
      const cantidad = interaction.options.getInteger("cantidad") || 1;
      const usarMaximo = interaction.options.getBoolean("maximo") || false;

      const { data: pa } = await supabase
        .from("player_artworks")
        .select("*, artworks(name, rarity_id)")
        .eq("id", paId)
        .eq("player_id", interaction.user.id)
        .single();

      if (!pa) {
        return interaction.editReply({
          content: "❌ Artwork no encontrado en tu inventario.",
        });
      }

      const { data: globalConfigData } = await supabase
        .from("global_configs")
        .select("key, value")
        .in("key", ["economy_costs", "game_modifiers"]);

      let ecoConfig = null;
      let gameModifiers = null;

      for (const row of globalConfigData || []) {
        if (row.key === "economy_costs") ecoConfig = row.value;
        if (row.key === "game_modifiers") gameModifiers = row.value;
      }

      const maxLevel = gameModifiers?.max_level || 100;
      const maxStars = gameModifiers?.max_stars || 10;
      const prestigeLevel = pa.prestige_level || 0;

      // 🛠️ Extraemos el rarity_id de la carta que el jugador quiere mejorar
      const rarityId = pa.artworks.rarity_id;

      let cost = 0;
      let currencyName = "";
      let currencyEmoji = "";
      let currentBalance = 0;
      let upgradeType = "";
      let targetValue = 0;

      if (sub === "level") {
        if (pa.level >= maxLevel)
          return interaction.editReply({
            content: `⛔ Esta carta ya está en el Nivel Máximo (${maxLevel}).\n Usa el comando \`/prestige\` para resetearla y obtener beneficios permanentes.`,
          });

        targetValue = pa.level;
        currentBalance = player.ink_dollars;
        currencyName = "Ink Dollars";
        currencyEmoji = "💰";

        if (usarMaximo) {
          while (targetValue < maxLevel) {
            const nextCost = calculateLevelUpgradeCost(
              pa.level,
              targetValue + 1,
              prestigeLevel,
              rarityId, // 🛠️ APLICADO
              ecoConfig,
            );
            if (nextCost > currentBalance) break;
            targetValue++;
            cost = nextCost;
          }
        } else {
          targetValue = Math.min(pa.level + cantidad, maxLevel);
          cost = calculateLevelUpgradeCost(
            pa.level,
            targetValue,
            prestigeLevel,
            rarityId, // 🛠️ APLICADO
            ecoConfig,
          );
        }

        if (targetValue === pa.level) {
          return interaction.editReply({
            content: `❌ No tienes suficientes fondos para subir de nivel.\nTu saldo: **${currentBalance.toLocaleString()} ${currencyEmoji}**.`,
          });
        }

        upgradeType = `Nivel ${pa.level} ➔ Nivel ${targetValue}`;
      } else if (sub === "stars") {
        if (pa.stars >= maxStars)
          return interaction.editReply({
            content: `❌ Este artwork ya tiene el máximo de ${maxStars} estrellas.`,
          });

        targetValue = pa.stars;
        currentBalance = player.star_dust;
        currencyName = "Polvo de Estrella";
        currencyEmoji = "✨";

        if (usarMaximo) {
          while (targetValue < maxStars) {
            const nextCost = calculateStarUpgradeCost(
              pa.stars,
              targetValue + 1,
              prestigeLevel,
              rarityId, // 🛠️ APLICADO
              ecoConfig,
            );
            if (nextCost > currentBalance) break;
            targetValue++;
            cost = nextCost;
          }
        } else {
          targetValue = Math.min(pa.stars + cantidad, maxStars);
          cost = calculateStarUpgradeCost(
            pa.stars,
            targetValue,
            prestigeLevel,
            rarityId, // 🛠️ APLICADO
            ecoConfig,
          );
        }

        if (targetValue === pa.stars) {
          return interaction.editReply({
            content: `❌ No tienes suficiente polvo para subir estrellas.\nTu saldo: **${currentBalance.toLocaleString()} ${currencyEmoji}**.`,
          });
        }

        upgradeType = `⭐ ${pa.stars} ➔ ⭐ ${targetValue}`;
      }

      if (currentBalance < cost) {
        return interaction.editReply({
          content: `❌ No tienes suficientes fondos.\nNecesitas **${cost.toLocaleString()}** ${currencyEmoji} ${currencyName}. Tienes **${currentBalance.toLocaleString()}**.`,
        });
      }

      const confirmEmbed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle("⚠️ Confirmar Mejora de carta")
        .setDescription(
          `¿Estás seguro de que deseas mejorar **${pa.artworks.name}**?`,
        )
        .setThumbnail(pa.artworks.sample_url || pa.artworks.image_url)
        .addFields(
          { name: "Mejora", value: upgradeType, inline: true },
          {
            name: "Costo Total",
            value: `${currencyEmoji} ${cost.toLocaleString()} ${currencyName}`,
            inline: true,
          },
          {
            name: "Fondos restantes",
            value: `${currencyEmoji} ${(currentBalance - cost).toLocaleString()}`,
            inline: true,
          },
        )
        .setFooter({
          text: `Prestigio Actual: 💠${prestigeLevel} | ID de Carta: ${pa.id}`,
        });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("confirm_upgrade")
          .setLabel("Confirmar")
          .setStyle(ButtonStyle.Success)
          .setEmoji("✅"),
        new ButtonBuilder()
          .setCustomId("cancel_upgrade")
          .setLabel("Cancelar")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("✖️"),
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
        if (i.customId === "cancel_upgrade") {
          const cancelEmbed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("🚫 Mejora Cancelada")
            .setDescription(
              "Has cancelado la operación. No se han gastado fondos.",
            );
          await i.update({ embeds: [cancelEmbed], components: [] });
          collector.stop("cancelled");
          return;
        }

        if (i.customId === "confirm_upgrade") {
          await i.deferUpdate();
          try {
            let resultMsg = "";
            if (sub === "level") {
              const result = await packService.upgradeLevel(
                interaction.user.id,
                pa.id,
                targetValue,
              );
              resultMsg = `✅ **${pa.artworks.name}** (🆔**${pa.id}**) subió a nivel **${result.newLevel}**\n(Costó ${currencyEmoji} ${result.cost.toLocaleString()} Ink$)`;
            } else if (sub === "stars") {
              const result = await packService.upgradeStars(
                interaction.user.id,
                pa.id,
                targetValue,
              );
              resultMsg = `✨ **${pa.artworks.name}** (🆔**${pa.id}**) ahora tiene **${result.newStars}** estrellas\n(Costó ${currencyEmoji} ${result.cost.toLocaleString()} Polvo)`;
            }

            const successEmbed = new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle("✅ ¡Mejora Exitosa!")
              .setDescription(resultMsg);
            await interaction.editReply({
              embeds: [successEmbed],
              components: [],
            });
            collector.stop("success");
          } catch (error) {
            await interaction.editReply({
              content: `❌ Error al aplicar la mejora: ${error.message}`,
              embeds: [],
              components: [],
            });
            collector.stop("error");
          }
        }
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time") {
          interaction.editReply({ components: [] }).catch(() => {});
        }
      });
    } catch (err) {
      console.error("[Upgrade]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },
};
