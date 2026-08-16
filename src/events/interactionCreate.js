const { Events, MessageFlags } = require("discord.js");

module.exports = {
  name: Events.InteractionCreate,

  async execute(interaction, client) {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        console.warn(
          `[Interaction] Unknown command: ${interaction.commandName}`,
        );
        return;
      }

      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(
          `[Interaction] Error in ${interaction.commandName}:`,
          err,
        );
        const reply = {
          content: "❌ Ocurrió un error al ejecutar el comando.",
          flags: MessageFlags.Ephemeral,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
      }
      return;
    }

    // Autocomplete
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command && command.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (err) {
          console.error(`[Autocomplete] Error:`, err);
        }
      }
      return;
    }

    // Button interactions (handled within commands via collectors)
    if (interaction.isButton()) {
      // Global button handlers can be added here if needed
      // Most buttons are handled by collectors in individual commands
    }
  },
};
