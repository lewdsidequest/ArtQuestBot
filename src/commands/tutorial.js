const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tutorial")
    .setDescription(
      "Aprende a jugar y descubre los mejores consejos para empezar",
    ),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("🎓 Tutorial: Bienvenido a ArtTradingBot")
      .setDescription(
        "¡Comienza tu aventura de coleccionismo y sobretodo GAMBLING! Aquí tienes todo lo que necesitas saber para ser el mejor.",
      )
      .addFields(
        {
          name: "🎯 ¿De qué trata el juego?",
          value:
            "El objetivo es coleccionar artworks (cartas), aumentar su nivel y sus estrellas para que generen la mayor cantidad de **Ink Dollars (Ink$)** posible por hora.",
        },
        {
          name: "🚀 Tus Primeros Pasos",
          value:
            "1️⃣ Usa `/daily` todos los días para obtener recompensas. (Hay un pequeño porcentaje aleatorio de JACKPOT diario que te da recompensas aumentadas.)\n2️⃣ Usa `/pack` para comprar sobres y obtener tus primeras cartas.\n3️⃣ Usa `/collect` para reclamar el dinero que tus cartas han estado generando pasivamente.",
        },
        {
          name: "💡 CONSEJO DE ORO *(META DEL JUEGO TEMPRANO)*",
          value:
            "Al principio, **prioriza subir las ESTRELLAS (⭐) de tus cartas antes que el Nivel** (Usa `/upgrade`). \n> Subir de nivel cuesta **Ink$** (que al inicio es muy escaso y lo necesitas para comprar sobres), mientras que las estrellas usan **Polvo de Estrella** (que obtienes al destruir cartas duplicadas o que no te gusten con `/destroy`). ¡Las estrellas aumentan tus ingresos mas que los niveles iniciales, aceleran tu progreso en el juego temprano **sin gastar Ink$**!",
        },
        {
          name: "⚙️ Mira tus cartas y gestiona tu inventario",
          value:
            "Usa `/inventory view` para inspeccionar tus cartas. Cuando tengas una que te encante, usa `/love` para protegerla de borrarla por accidente y exhibirla en tu `/profile`.",
        },
        {
          name: "🔁 Intercambios de Cartas",
          value:
            "¡Aprovecha el comando `/trade` para intercambiar cartas con tus amigos!\n\n⚠️Recuerda que **el bot no se hace responsable de los intercambios**, así que asegúrate de que ambos jugadores estén de acuerdo antes de confirmar un intercambio.\n",
        },
      )
      .setFooter({
        text: "Usa /help para más información o /info comandos para la lista completa.",
      });

    await interaction.reply({ embeds: [embed] });
  },
};
