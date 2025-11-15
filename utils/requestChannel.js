// utils/requestChannel.js
const { PermissionsBitField } = require('discord.js');
const config = require('../config/config.js');
const log = require('./logWriter');
const { createTempChannel } = require('./channelUtils');
const { recordUserActivity } = require('./cleanupService');
const { ensureDMMenu } = require('./dmMenu');
const { trackActiveDM } = require('./database');

/**
 * Resolves where to send a response:
 * - In DM mode: attempts to open a DM, cleans old messages, ensures menu exists, then returns DM channel.
 * - In Channel mode (or DM fallback): creates or reuses a temp channel.
 */
async function resolveResponseChannel(interaction, client) {
  const user = interaction.user;

  // 1️⃣ DM mode: try DM first
  if (config.requestMode === 'dm') {
    try {
      const dm = await user.createDM();
      log.debug(`[REQUEST] Opened DM for ${user.tag}`);
      
      // Track this DM for cleanup on next startup
      await trackActiveDM(user.id, dm.id);
      
      // Record user activity (resets cleanup timer)
      recordUserActivity(user.id);
      
      // Ensure the main menu exists at the top
      await ensureDMMenu(dm, client);
      
      return dm;
    } catch (err) {
      log.warn(`[REQUEST] Could not open DM for ${user.tag}: ${err.message}. Falling back to channel.`);
      // continue to channel fallback
    }
  }

  // 2️⃣ Channel mode or DM fallback: use channelUtils.createTempChannel
  let channel;
  try {
    channel = await createTempChannel(interaction, client);
  } catch (err) {
    log.error(`[REQUEST] Failed to create/reuse temp channel`, err);
    // Fallback to the original interaction channel if available
    if (interaction.channel && interaction.channel.isTextBased()) {
      log.debug(`[REQUEST] Using original channel for ${user.tag}`);
      return interaction.channel;
    }
    // No valid channel available
    throw err;
  }

  return channel;
}

module.exports = {
  resolveResponseChannel
};
