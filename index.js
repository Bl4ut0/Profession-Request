const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { registerCommands } = require('./utils/commandRegistrar');
const { handleInteractions } = require('./interactions/interactionRouter');
const { initDatabase } = require('./utils/database');
const { ensurePrimaryRequestChannel } = require('./utils/primaryChannel');
const { performStartupCleanup } = require('./utils/startupCleanup');
const { loadProfessions } = require('./utils/professionLoader');
const { scheduleAutomaticBackups } = require('./utils/databaseBackup');
const { clearAllTracking } = require('./utils/cleanupService');
const config = require('./config/config.js');
const fs = require('fs');
const log = require('./utils/logWriter');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

client.commands = new Collection();
/*
// Disabled during button-only testing: do not load slash commands
const commandFiles = fs
  .readdirSync(path.join(__dirname, './commands'))
  .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    log.debug(`Loaded command: /${command.data.name}`);
  } else {
    log.warn(`Skipped invalid command: ${file}`);
  }
}
*/

client.once('clientReady', async () => {
  log.info(`Bot online as ${client.user.tag}`);

  // Load profession data into memory for fast access
  const professionLoadResult = loadProfessions();
  log.info(`Profession cache ready: ${professionLoadResult.professionsLoaded} professions loaded`);

  // Initialize SQLite schema
  await initDatabase();

  // Register slash commands with Discord
  // Disabled during button-only testing: do not register slash commands
  // await registerCommands(client, process.env.CLIENT_ID, process.env.GUILD_ID);

  // Ensure the #requests channel (and category) exists
  await ensurePrimaryRequestChannel(client);

  // Clear all in-memory tracking from previous session
  clearAllTracking();

  // Clean up old messages and channels from previous session
  await performStartupCleanup(client);
  
  // Schedule automatic database backups
  scheduleAutomaticBackups(client);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      log.info(`Slash command: /${interaction.commandName} by ${interaction.user.tag}`);
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        log.warn(`Command not found: /${interaction.commandName}`);
        return interaction.reply({ content: 'Command not registered.', flags: 1 << 6 });
      }
      await command.execute(interaction, client);

    } else {
      // Delegate buttons & dropdowns
      await handleInteractions(interaction, client);
    }
  } catch (error) {
    log.error('Unhandled interaction error:', error);
    
    // Don't try to respond to expired interactions (code 10062)
    if (error.code === 10062) {
      log.debug('Interaction expired - operation may have completed successfully');
      return;
    }
    
    const opts = { content: 'An error occurred.', flags: 1 << 6 };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(opts);
      } else {
        await interaction.reply(opts);
      }
    } catch (replyErr) {
      // Silently ignore if we can't send the error message
      if (replyErr.code !== 10062) {
        log.error('Failed to send error response:', replyErr);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
