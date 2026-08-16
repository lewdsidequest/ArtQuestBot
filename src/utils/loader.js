const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');

/**
 * Dynamically load all command modules from the commands directory.
 */
function loadCommands() {
  const commands = new Collection();
  const commandFiles = fs.readdirSync(path.join(__dirname, '..', 'commands'))
    .filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(__dirname, '..', 'commands', file);
    const command = require(filePath);

    if ('data' in command && 'execute' in command) {
      commands.set(command.data.name, command);
    } else {
      console.warn(`[Loader] Command ${file} missing 'data' or 'execute'`);
    }
  }

  return commands;
}

module.exports = { loadCommands };
