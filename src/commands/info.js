const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const GAME = require("../config/game");
const artworkService = require("../services/artwork");
const RarityManager = require("../utils/rarity"); // 🛠️ Importamos el gestor numérico de rarezas

module.exports = {
  data: new SlashCommandBuilder()
    .setName("info")
    .setDescription("Información del juego, probabilidades y lista de comandos")
    .addSubcommand((sub) =>
      sub
        .setName("general")
        .setDescription(
          "Muestra información general sobre la economía y reglas del bot",
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("comandos")
        .setDescription(
          "Muestra un glosario con todos los comandos disponibles",
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("packs")
        .setDescription("Ver probabilidades de una colección específica")
        .addStringOption((opt) =>
          opt
            .setName("coleccion")
            .setDescription("Escribe el nombre o tag de la colección")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const sub = interaction.options.getSubcommand();

      // ==========================================
      // SUBCOMANDO: PACKS (PROBABILIDADES)
      // ==========================================
      if (sub === "packs") {
        const slug = interaction.options.getString("coleccion");
        const collection = await artworkService.getCollectionWithConfigs(slug);

        if (!collection) {
          return interaction.editReply({
            content: "❌ Colección no encontrada.",
          });
        }

        const lines = collection.configs
          .sort((b, a) => a.probability - b.probability) // Ordenar de más común a más raro
          .map((cfg) => {
            // 🛠️ Extraemos la rareza dinámica usando el ID
            const rarityData = RarityManager.get(cfg.rarity_id);
            const rarityName = rarityData ? rarityData.name : "Unknown";
            const rarityEmoji = rarityData ? rarityData.emoji : "⚪";

            // AHORA LEEMOS EL COSTO DESDE rarityData EN LUGAR DE cfg
            const costMult = rarityData ? rarityData.cost_multiplier : 1;

            return `${rarityEmoji} **${rarityName}** — ${(cfg.probability * 100).toFixed(2)}% | Base: ${cfg.base_ink_rate} Ink$/hora | Costo Mejora: x${costMult}`;
          });

        const embed = new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`📊 Probabilidades: ${collection.name}`)
          .setDescription(lines.join("\n\n"))
          .setFooter({
            text: `Fuente de imágenes: ${collection.default_api || "Global (Safebooru/Rule34)"}`,
          });

        return interaction.editReply({ embeds: [embed] });
      }

      // ==========================================
      // SUBCOMANDO: COMANDOS (GLOSARIO)
      // ==========================================
      if (sub === "comandos") {
        const embed = new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle("📚 Lista de Comandos")
          .setDescription(
            "Aquí se muestran los principales comandos organizados por categoría:",
          )
          .addFields(
            {
              name: "💰 Economía y Progreso",
              value:
                "`/daily` - Reclama un bono diario de Ink$ (dinero) y Polvo de Estrella✨ (Hay un pequeño porcentaje de JACKPOT que te da recompensas aumentadas.)\n`/collect` - Recolecta el Ink$ que han generado tus cartas.\n`/money` - Revisa tu saldo de dinero e ingresos rápidamente.\n`/generators` - Mira cuáles de tus cartas están produciendo Ink$.",
            },
            {
              name: "🎒 Inventario y Cartas",
              value:
                "`/pack` - Compra y abre sobres de cartas.\n`/inventory` - Explora, ordena y visualiza tus cartas.\n`/upgrade` - Sube el nivel (con Ink$) o las estrellas (con Polvo✨) de una carta.\n`/destroy` - Convierte cartas que no quieras en Polvo de Estrella✨.",
            },
            {
              name: "💖 Coleccionismo",
              value:
                "`/favorite` - Gestiona tus cartas favoritas y tu álbum (binder).\n`/love` - Marca una única carta especial para destacarla en tu perfil.\n`/view` - Observa cualquier carta en tamaño completo usando su ID. (Tambien es la mejor forma de ver cartas tipo VIDEO 😏)",
            },
            {
              name: "🤝 Social",
              value:
                "`/profile` - Mira tu perfil, ingresos y medallas (o el de otros).\n`/trade` - Intercambia cartas de forma segura con otros jugadores.",
            },
            {
              name: "🤑 GAMBLING",
              value:
                "> **⚠️ADVERTENCIA⚠️:** *Estas actividades estan pensadas para el LATE GAME donde ya tienes un buen stock de cartas y mucho dinero para gastar.*\n`/gambling` - Participa en actividades para apostar y poner a prueba tu suerte (y quemar tus Ink$ XD).\n`/gacha` - Prueba tu suerte con el Gacha, es dificil pero si ganas el premio mayor obtendras cartas aleatorias de colecciones exclusivas (CARTAS PROMO).",
            },
            {
              name: "🆘 Ayuda",
              value:
                "`/tutorial` - Guía rápida para empezar a jugar.\n`/info` - Ver reglas globales y probabilidades de sobres.\n`/help` - Centro de ayuda rápida.",
            },
          )
          .setFooter({
            text: "Tip: Escribe '/' y selecciona el logo del bot para ver los comandos en la interfaz de Discord.",
          });

        return interaction.editReply({ embeds: [embed] });
      }

      // ==========================================
      // SUBCOMANDO: GENERAL (INFORMACIÓN DEL JUEGO)
      // ==========================================
      if (sub === "general") {
        const embed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle("🎨 ArtTradingBot - Información")
          .setDescription(
            "Colecciona artworks, mejóralos, genera Ink Dollars y gástalos en todo tipo de actividades y objetos.",
          )
          .addFields(
            {
              name: "💰 Economía Offline",
              value: `Reclamo disponible cada cierto numero de **horas** (se puede reducir).\n> Tus ingresos por hora se acumulan hasta cierto límite (aunque estes offline)`,
              inline: true,
            },
            {
              name: "⭐ Estrellas",
              value: `Máximo **${GAME.rarities.stars.max}** estrellas\n+${(GAME.rarities.stars.multiplierPerStar * 1000).toFixed(0)}% ingresos por cada estrella`,
              inline: true,
            },
            {
              name: "📈 Niveles",
              value: `Maximo: Nv. 69\n+${(GAME.rarities.levels.multiplierPerLevel * 100).toFixed(0)}% ingresos por cada nivel (acumulable)`,
              inline: true,
            },
            {
              name: "💠 Prestigio",
              value: `Maximo: Nv. 20\nAl subir una carta a Nv. 69 podras subir el nivel de prestigio a cambio de reiniciar el nivel de la carta a 1, cada prestigio aumenta multiplicativamente el dinero que generara la carta.`,
              inline: true,
            },
          )
          .setFooter({
            text: "Desarrollado para coleccionistas y amantes del arte para adultos. ¡Usa /tutorial si eres nuevo!",
          });

        return interaction.editReply({ embeds: [embed] });
      }
    } catch (err) {
      console.error("[Info]", err);
      await interaction.editReply({ content: `❌ Error: ${err.message}` });
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const collections = await artworkService.listCollections();

    const filtered = collections
      .filter((c) => {
        const query = focused.toLowerCase();
        const matchesName = c.name.toLowerCase().includes(query);
        const matchesSlug = c.slug.toLowerCase().includes(query);
        // 🛠️ Permitimos buscar por tags también
        const matchesTags = c.content_tags
          ? c.content_tags.toLowerCase().includes(query)
          : false;
        return matchesName || matchesSlug || matchesTags;
      })
      .slice(0, 25);

    await interaction.respond(
      filtered.map((c) => {
        let baseText = c.name;
        if (c.content_tags) baseText += ` | ${c.content_tags}`;

        let displayName = baseText;
        if (displayName.length > 100) {
          displayName = displayName.substring(0, 97) + "...";
        }

        return { name: displayName, value: c.slug };
      }),
    );
  },
};
