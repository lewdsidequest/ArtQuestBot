const {
  Client,
  GatewayIntentBits,
  ActivityType,
  Events,
} = require("discord.js");
const { loadCommands } = require("./utils/loader");
const interactionCreate = require("./events/interactionCreate");
require("dotenv").config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.commands = loadCommands();

client.once(Events.ClientReady, () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  require("./utils/rarity").loadRarities();
  client.user.setActivity("/register para empezar", {
    type: ActivityType.Playing,
  });
});

client.on(interactionCreate.name, (interaction) =>
  interactionCreate.execute(interaction, client),
);

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("[Bot] DISCORD_TOKEN not found in environment");
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error("[Bot] Login failed:", err.message);
  process.exit(1);
});
