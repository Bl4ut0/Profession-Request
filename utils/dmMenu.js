// utils/dmMenu.js
const log = require('./logWriter');
const { buildMainMenu } = require('./menuBuilder');
const cleanupService = require('./cleanupService');
const config = require('../config/config.js');

/**
 * Sends or updates the main menu in a DM channel.
 * This menu stays at the top and provides quick access to all bot features.
 * @param {import('discord.js').DMChannel} dmChannel The DM channel
 * @param {import('discord.js').Client} client The Discord client
 */
async function ensureDMMenu(dmChannel, client) {
  if (!dmChannel || !client) return;

  try {
    // Small delay to ensure cleanup has completed
    await new Promise(resolve => setTimeout(resolve, config.messageFetchDelay));
    
    // Check if menu already exists (fetch more messages to account for deletions)
    const messages = await dmChannel.messages.fetch({ limit: config.messageFetchLimit });
    
    // Find ALL existing menus (to handle duplicates)
    const existingMenus = messages.filter(msg => 
      msg.author.id === client.user.id && 
      msg.content.includes('📌 **Welcome to the Guild Request System!**')
    );

    // Build unified menu (same as channel mode)
    const menu = buildMainMenu();

    if (existingMenus.size > 0) {
      // Sort by creation time (oldest first)
      const sortedMenus = Array.from(existingMenus.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      
      // Keep the OLDEST menu (it should be at the top) and delete any duplicates
      const menuToKeep = sortedMenus[0];
      const duplicates = sortedMenus.slice(1);
      
      // Delete duplicate menus
      for (const duplicate of duplicates) {
        try {
          await duplicate.delete();
          log.info(`[DM_MENU] Deleted duplicate primary menu (ID: ${duplicate.id})`);
          await new Promise(resolve => setTimeout(resolve, config.messageDeleteDelay));
        } catch (err) {
          if (err.code !== 10008) { // Ignore "Unknown Message" error
            log.warn(`[DM_MENU] Could not delete duplicate menu: ${err.message}`);
          }
        }
      }
      
      // Update the kept menu to ensure buttons are fresh
      await menuToKeep.edit({
        content: menu.content,
        components: menu.components
      });
      const recipientTag = dmChannel.recipient?.tag || dmChannel.recipient?.username || 'Unknown User';
      log.debug(`[DM_MENU] Updated existing menu for ${recipientTag}${duplicates.length > 0 ? ` (removed ${duplicates.length} duplicate(s))` : ''}`);
    } else {
      // Menu doesn't exist - create it
      await dmChannel.send({
        content: menu.content,
        components: menu.components
      });
      const recipientTag = dmChannel.recipient?.tag || dmChannel.recipient?.username || 'Unknown User';
      log.info(`[DM_MENU] Created new menu for ${recipientTag}`);
    }
    
    // Schedule PRIMARY_MENU cleanup (5 minutes of inactivity = complete cleanup)
    // This ensures completely inactive users get cleaned up after submenus expire
    // User has: 90s submenu timeout + 3.5min primary menu = plenty of time to return
    if (config.requestMode === 'dm' && dmChannel.recipient) {
      const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.PRIMARY_MENU);
      cleanupService.scheduleDMCleanup(dmChannel, client, timeout, dmChannel.recipient.id);
      log.debug(`[DM_MENU] Scheduled PRIMARY_MENU cleanup (${timeout/1000}s) for ${dmChannel.recipient.tag || 'user'}`);
    }
  } catch (err) {
    log.warn(`[DM_MENU] Could not ensure DM menu: ${err.message}`);
  }
}

module.exports = {
  ensureDMMenu
};
