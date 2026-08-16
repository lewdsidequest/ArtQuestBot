const express = require("express");
const {
  Client,
  GatewayIntentBits,
  ActivityType,
  Events,
} = require("discord.js");
const { loadCommands } = require("./utils/loader");
const interactionCreate = require("./events/interactionCreate");
require("dotenv").config();

// ==========================================
// CONFIGURACIÓN DEL SERVIDOR WEB (EXPRESS)
// ==========================================
const app = express();
// Hostinger (o la plataforma en uso) inyectará el puerto aquí, si no, usa el 8000
const port = process.env.PORT || 8000;

app.get("/", (req, res) => {
  res.send("El bot de Discord está en línea y funcionando.");
});

app.listen(port, () => {
  console.log(
    `[Web] Servidor de mantenimiento escuchando en el puerto ${port}`,
  );
});

// ==========================================
// CONFIGURACIÓN DEL BOT DE DISCORD
// ==========================================
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
