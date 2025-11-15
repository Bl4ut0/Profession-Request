const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const log = require('./logWriter');

async function registerCommands(client, clientId, guildId) {
  const commands = [];
  const commandFiles = fs.readdirSync(path.join(__dirname, '../commands')).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(`../commands/${file}`);
    if ('data' in command && 'execute' in command) {
      commands.push(command.data.toJSON());
    } else {
      log.warn(`The command at ${file} is missing required "data" or "execute".`);
    }
  }

  // Validate environment variables before attempting registration
  const token = process.env.DISCORD_TOKEN;

  if (!clientId || !guildId || !token) {
    log.error('Missing required environment variables:', {
      hasClientId: !!clientId,
      hasGuildId: !!guildId,
      hasToken: !!token
    });
    return;
  }

  // Validate that IDs are actual Discord snowflakes (18-digit numbers)
  // Placeholder strings are typically shorter or contain 'YOUR_'
  const isValidSnowflake = (id) => /^\d{17,20}$/.test(id);
  
  if (!isValidSnowflake(clientId)) {
    log.error(`Invalid CLIENT_ID format. Expected 18-20 digit snowflake, got: ${clientId}`);
    return;
  }
  
  if (!isValidSnowflake(guildId)) {
    log.error(`Invalid GUILD_ID format. Expected 18-20 digit snowflake, got: ${guildId}`);
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    log.info('Registering slash commands...');
    log.debug(`Using Client ID: ${clientId}, Guild ID: ${guildId}`);

    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );

    log.info('Slash commands registered successfully.');
  } catch (error) {
    log.error('Error registering commands:', error);
  }
}

module.exports = {
  registerCommands
};
