// utils/channelUtils.js
const config = require('../config/config.js');
const log = require('./logWriter');
const { scheduleChannelDeletion } = require('./cleanupService');

/**
 * Deletes all messages in a given channel.
 * @param {import('discord.js').TextChannel} channel The channel to clear.
 */
async function clearChannel(channel) {
  if (!channel) return;

  try {
    let fetched;
    do {
      fetched = await channel.messages.fetch({ limit: config.messageFetchLimit });
      if (fetched.size > 0) {
        await channel.bulkDelete(fetched, true);
      }
    } while (fetched.size >= 100);
    log.info(`[CLEANUP] Cleared all messages in channel ${channel.name}`);
  } catch (err) {
    log.error(`[CLEANUP] Failed to clear channel ${channel.name}: ${err.message}`);
  }
}

/**
 * Creates or reuses a temporary request channel for the user.
 * Channel name: {requestChannelName}-{username}
 * Reuses existing channel if found, else creates new.
 * Schedules auto-deletion after inactivity (submenu timeout from cleanupTimeouts config).
 */
async function createTempChannel(interaction, client) {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) throw new Error('Guild not found in cache.');

  // Build base channel name using user ID (guaranteed unique, prevents collisions)
  const baseName = `${config.requestChannelName}-${interaction.user.id}`;

  // Look for existing channel under the category
  await guild.channels.fetch(); // ✅ FIXED: Fetch channels to ensure cache is up-to-date
  let channel = guild.channels.cache.find(
    ch => ch.name === baseName && ch.parentId === config.requestCategoryId
  );

  if (channel) {
    if (config.debugMode) log.info(`[CHANNEL] Reusing channel: ${channel.name}`);
    await clearChannel(channel); // Clear the channel before reusing
  } else {
    channel = await guild.channels.create({
      name: baseName,
      type: 0, // GuildText
      parent: config.requestCategoryId,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: ['ViewChannel']
        },
        {
          id: interaction.user.id,
          allow: ['ViewChannel', 'SendMessages']
        },
        {
          id: client.user.id,
          allow: ['ViewChannel', 'SendMessages', 'ManageChannels']
        }
      ],
      reason: `Temporary request channel for ${interaction.user.tag}`
    });
    if (config.debugMode) log.info(`[CHANNEL] Created channel: ${channel.name}`);
  }

  // Use unified cleanupService for scheduling deletion (prevents duplicate timers)
  scheduleChannelDeletion(channel);
  return channel;
}

module.exports = {
  createTempChannel,
  clearChannel,
};
