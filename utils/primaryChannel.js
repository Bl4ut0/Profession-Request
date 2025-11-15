// utils/primaryChannel.js
const { ChannelType } = require('discord.js');
const config = require('../config/config.js');
const log = require('./logWriter');
const { buildMainMenu } = require('./menuBuilder');

async function ensurePrimaryRequestChannel(client) {
  // 1️⃣ Fetch the guild
  const guild = await client.guilds.fetch(config.guildId);

  // 2️⃣ Fetch or create the primary text channel
  let channel;
  
  // If channel ID is provided, use it directly
  if (config.requestChannelId) {
    channel = guild.channels.cache.get(config.requestChannelId);
    if (!channel) {
      throw new Error(`Request channel not found (ID: ${config.requestChannelId}). Please verify the channel exists or set requestChannelId to null to auto-create.`);
    }
    if (config.debugMode) log.info(`[INIT] Using existing channel #${channel.name} (${channel.id})`);
  } else {
    // Only create channel if requestChannelId is null (requires Manage Channels permission)
    // Skip channel creation in DM mode to reduce permission requirements
    if (config.requestMode === 'dm') {
      if (config.debugMode) log.info('[INIT] DM mode with no requestChannelId - skipping channel creation');
      return null;
    }

    // Verify category exists (don't create - requires fewer permissions)
    let category = guild.channels.cache.get(config.requestCategoryId);
    if (!category) {
      throw new Error(`Category not found (ID: ${config.requestCategoryId}). Please create the category manually and update config.js with the correct ID.`);
    }

    // Auto-create channel (requires Manage Channels permission)
    await guild.channels.fetch();
    channel = guild.channels.cache.find(ch =>
      ch.name === config.requestChannelName &&
      ch.parentId === config.requestCategoryId &&
      ch.type === ChannelType.GuildText
    );
    if (!channel) {
      channel = await guild.channels.create({
        name: config.requestChannelName,
        type: ChannelType.GuildText,
        parent: config.requestCategoryId,
        topic: 'Use slash commands or buttons below to interact with the guild request system.'
      });
      if (config.debugMode) log.info(`[INIT] Created #${config.requestChannelName} (${channel.id}). Add this to config: requestChannelId: "${channel.id}"`);
    } else if (config.debugMode) {
      log.info(`[INIT] Found existing #${config.requestChannelName} (${channel.id}). Add this to config: requestChannelId: "${channel.id}"`);
    }
  }

  // 4️⃣ Check for existing menu message (check recent messages to avoid deprecated API)
  const recentMessages = await channel.messages.fetch({ limit: config.messageFetchLimit });
  const existingMenu = recentMessages.find(msg => 
    msg.author.id === client.user.id && 
    msg.components.length > 0 &&
    msg.content.includes('🎯 **Guild Request System**')
  );

  if (existingMenu) {
    if (config.debugMode) log.info(`[INIT] Found existing menu message in #${channel.name}, skipping creation`);
    
    // Clear any other messages (but keep the existing menu)
    const toDelete = recentMessages.filter(msg => msg.id !== existingMenu.id);
    if (toDelete.size > 0) {
      try {
        await channel.bulkDelete(toDelete, true);
        if (config.debugMode) log.info(`[INIT] Cleared ${toDelete.size} non-menu messages in #${channel.name}`);
      } catch (err) {
        log.warn(`[INIT] Failed to clear messages in #${channel.name}: ${err.message}`);
      }
    }
    
    return;
  }

  // 5️⃣ Clear all messages if no existing menu found
  try {
    const fetched = await channel.messages.fetch({ limit: config.messageFetchLimit });
    await channel.bulkDelete(fetched, true);
    if (config.debugMode) log.info(`[INIT] Cleared recent messages in #${channel.name}`);
  } catch (err) {
    log.warn(`[INIT] Failed to clear messages in #${channel.name}: ${err.message}`);
  }

  // 6️⃣ Send unified menu message and pin it
  const menu = buildMainMenu();
  
  const instruction = await channel.send({
    content: menu.content,
    components: menu.components
  });

  await instruction.pin().catch(() => {});
}

module.exports = {
  ensurePrimaryRequestChannel
};
