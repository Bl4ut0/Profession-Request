// utils/navigationHelper.js
const config = require('../config/config');

/**
 * Determines if a navigation message should be shown based on context.
 * 
 * Rules:
 * 1. If showNavigationMessages is false in config, never show
 * 2. If interaction originated in a DM, never show (already in DM)
 * 3. If interaction originated in guild channel, show navigation
 * 
 * @param {import('discord.js').Interaction} interaction 
 * @returns {boolean} True if should show navigation message
 */
function shouldShowNavigation(interaction) {
  // Config override - if disabled, never show
  if (config.showNavigationMessages === false) {
    return false;
  }
  
  // If in DM, don't show navigation (already there)
  if (interaction.channel?.type === 1) { // DMChannel type
    return false;
  }
  
  // If in guild, show navigation
  return true;
}

/**
 * Gets the appropriate navigation message based on mode and context.
 * 
 * @param {import('discord.js').Interaction} interaction 
 * @param {import('discord.js').Channel} targetChannel The channel where content was sent
 * @returns {string|null} Navigation message or null if shouldn't show
 */
function getNavigationMessage(interaction, targetChannel) {
  if (!shouldShowNavigation(interaction)) {
    return null;
  }
  
  if (config.requestMode === 'dm') {
    return '✅ I\'ve sent you a DM—please check your direct messages.';
  } else {
    return `✅ Continue in <#${targetChannel.id}>.`;
  }
}

module.exports = {
  shouldShowNavigation,
  getNavigationMessage
};
