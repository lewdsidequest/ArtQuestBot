const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const economy = require('../services/economy');
const gallery = require('../services/gallery');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Muestra el ranking de jugadores')
    .addStringOption(opt =>
      opt.setName('tipo')
        .setDescription('Tipo de ranking')
        .setRequired(false)
        .addChoices(
          { name: 'Ink Dollars', value: 'ink' },
          { name: 'Total Reclamado', value: 'claimed' },
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const type = interaction.options.getString('tipo') || 'ink';
      const leaderboard = await gallery.getLeaderboard(type, 10);

      if (!leaderboard.length) {
        await interaction.editReply({ content: 'No hay jugadores en el ranking todavía.' });
        return;
      }

      const lines = leaderboard.map((p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '•';
        const value = type === 'ink' ? p.ink_dollars.toLocaleString() : p.total_claimed.toLocaleString();
        return `${medal} **${p.username || 'Unknown'}** — ${value} ${type === 'ink' ? 'Ink$' : 'total'}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(type === 'ink' ? '🏆 Ranking de Ink Dollars' : '🏆 Ranking de Ingresos Totales')
        .setDescription(lines.join('\n'));

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[Leaderboard]', err);
      await interaction.editReply({ content: `Error: ${err.message}` });
    }
  },
};
