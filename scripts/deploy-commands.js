const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const commands = [];
const commandFiles = fs
  .readdirSync(path.join(__dirname, "..", "src", "commands"))
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(__dirname, "..", "src", "commands", file));
  if ("data" in command && "execute" in command) {
    commands.push(command.data.toJSON());
  } else {
    console.warn(`[Deploy] Skipping ${file}: missing data or execute`);
  }
}

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(
      `[Deploy] Refreshing ${commands.length} application (/) commands...`,
    );

    let data;
    if (process.env.DISCORD_GUILD_ID) {
      // Guild-specific deploy (faster for testing)
      data = await rest.put(
        Routes.applicationGuildCommands(
          process.env.DISCORD_CLIENT_ID,
          process.env.DISCORD_GUILD_ID,
        ),
        { body: commands },
      );
      console.log(
        `[Deploy] Registered ${data.length} guild commands to ${process.env.DISCORD_GUILD_ID}`,
      );
    } else {
      // Global deploy (takes up to 1 hour to propagate)
      data = await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commands },
      );
      console.log(`[Deploy] Registered ${data.length} global commands`);
    }
  } catch (err) {
    console.error("[Deploy] Error:", err);
    process.exit(1);
  }
})();
