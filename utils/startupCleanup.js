// utils/startupCleanup.js
const config = require('../config/config.js');
const log = require('./logWriter');
const { ChannelType } = require('discord.js');
const { getAllActiveDMs, removeActiveDM, cleanupOldDMTracking } = require('./database');

/**
 * Cleans up old bot messages on startup
 * - In DM mode: Cleans bot messages from all recent DM conversations
 * - In Channel mode: Deletes all temporary request channels
 */
async function performStartupCleanup(client) {
  if (!config.cleanupOnStartup) {
    log.info('[STARTUP CLEANUP] Cleanup disabled in config');
    return;
  }

  log.info('[STARTUP CLEANUP] Starting cleanup process...');

  try {
    if (config.requestMode === 'dm') {
      await cleanupDMsOnStartup(client);
    } else if (config.requestMode === 'channel') {
      await cleanupChannelsOnStartup(client);
    }
    log.info('[STARTUP CLEANUP] Cleanup complete');
  } catch (err) {
    log.error('[STARTUP CLEANUP] Error during cleanup:', err);
  }
}

/**
 * Cleans up bot messages from all tracked DM channels
 */
async function cleanupDMsOnStartup(client) {
  log.info('[STARTUP CLEANUP] Cleaning DM messages...');

  let dmCount = 0;
  let messageCount = 0;

  try {
    // Get all tracked DMs from database
    const trackedDMs = await getAllActiveDMs();
    log.info(`[STARTUP CLEANUP] Found ${trackedDMs.length} tracked DM channels`);

    for (const record of trackedDMs) {
      try {
        // Fetch the user
        const user = await client.users.fetch(record.user_id).catch(() => null);
        if (!user) {
          log.debug(`[STARTUP CLEANUP] User ${record.user_id} not found, removing from tracking`);
          await removeActiveDM(record.user_id);
          continue;
        }

        // Get DM channel
        const dmChannel = await user.createDM().catch(() => null);
        if (!dmChannel) {
          log.debug(`[STARTUP CLEANUP] Could not open DM with ${user.tag}, removing from tracking`);
          await removeActiveDM(record.user_id);
          continue;
        }

        // Fetch and delete ALL bot messages (including main menu to prevent buildup)
        const messages = await dmChannel.messages.fetch({ limit: config.messageFetchLimit });
        const botMessages = messages.filter(m => m.author.id === client.user.id);

        if (botMessages.size > 0) {
          log.debug(`[STARTUP CLEANUP] Cleaning ${botMessages.size} messages from DM with ${user.tag} (including main menu)`);
          
          for (const message of botMessages.values()) {
            try {
              await message.delete();
              messageCount++;
              // Small delay to avoid rate limits
              await new Promise(resolve => setTimeout(resolve, config.startupDMCleanupDelay));
            } catch (err) {
              if (err.code !== 10008) { // Ignore "Unknown Message" errors
                log.debug(`[STARTUP CLEANUP] Could not delete message: ${err.message}`);
              }
            }
          }
          dmCount++;
          log.debug(`[STARTUP CLEANUP] Cleaned ALL messages from DM with ${user.tag}`);
        } else {
          log.debug(`[STARTUP CLEANUP] No bot messages to clean in DM with ${user.tag}`);
        }
        
        // Remove from tracking since cleanup is complete
        // User will be re-tracked if they interact with the bot again
        await removeActiveDM(record.user_id);

      } catch (err) {
        log.debug(`[STARTUP CLEANUP] Error processing DM for user ${record.user_id}: ${err.message}`);
      }
    }

    // Clean up old tracking entries (older than 7 days)
    await cleanupOldDMTracking();

    log.info(`[STARTUP CLEANUP] Cleaned ${messageCount} messages from ${dmCount} DM channels`);
  } catch (err) {
    log.error('[STARTUP CLEANUP] Error cleaning DMs:', err);
  }
}

/**
 * Deletes all temporary request channels on startup
 */
async function cleanupChannelsOnStartup(client) {
  log.info('[STARTUP CLEANUP] Cleaning temporary channels...');

  let channelCount = 0;

  try {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
      log.warn('[STARTUP CLEANUP] Guild not found in cache');
      return;
    }

    // Fetch all channels to ensure cache is up-to-date
    await guild.channels.fetch();

    // Find all channels that match the request channel naming pattern
    const tempChannels = guild.channels.cache.filter(
      channel => 
        channel.name.startsWith(config.requestChannelName + '-') &&
        channel.parentId === config.requestCategoryId &&
        channel.type === ChannelType.GuildText
    );

    log.info(`[STARTUP CLEANUP] Found ${tempChannels.size} temporary channels`);

    for (const [channelId, channel] of tempChannels) {
      try {
        await channel.delete('🧹 Startup cleanup: Removing old request channels');
        channelCount++;
        log.debug(`[STARTUP CLEANUP] Deleted channel: ${channel.name}`);
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, config.startupChannelCleanupDelay));
      } catch (err) {
        log.warn(`[STARTUP CLEANUP] Could not delete channel ${channel.name}: ${err.message}`);
      }
    }

    log.info(`[STARTUP CLEANUP] Deleted ${channelCount} temporary channels`);
  } catch (err) {
    log.error('[STARTUP CLEANUP] Error cleaning channels:', err);
  }
}

module.exports = {
  performStartupCleanup,
  cleanupDMsOnStartup,
  cleanupChannelsOnStartup
};
