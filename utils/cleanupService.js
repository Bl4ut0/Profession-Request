// utils/cleanupService.js
const config = require('../config/config.js');
const log = require('./logWriter.js');

// Unified timer map for all cleanup operations
const activeTimers = new Map();

// Session activity tracking - tracks last activity per user to prevent mid-flow cleanup
const userActivity = new Map(); // Map<userId, timestamp>

// Channel tracking for cleanup - just stores channelId per user
const userChannels = new Map(); // Map<userId, channelId>

// Hierarchical menu tracking - tracks messages by depth level
const menuHierarchy = new Map(); // Map<userId, Map<level, messageIds[]>>

/**
 * Message type constants for cleanup scheduling
 */
const MessageType = {
  PRIMARY_MENU: 'primaryMenu',
  SUBMENU: 'submenu',
  COMPLETION: 'completion'
};

/**
 * Gets the appropriate cleanup timeout for a message type
 * @param {string} messageType - One of MessageType constants
 * @returns {number} - Timeout in milliseconds
 */
function getCleanupTimeout(messageType) {
  if (!config.cleanupTimeouts) {
    log.error('[CLEANUP] cleanupTimeouts not found in config - using legacy defaults');
    return 90000; // Fallback to 90 seconds
  }
  
  const timeout = config.cleanupTimeouts[messageType];
  if (timeout === undefined) {
    log.warn(`[CLEANUP] Unknown message type: ${messageType} - using submenu timeout`);
    return config.cleanupTimeouts.submenu || 90000;
  }
  
  return timeout;
}

/**
 * Records user activity to prevent cleanup during active sessions
 * @param {string} userId - The user ID
 */
function recordUserActivity(userId) {
  userActivity.set(userId, Date.now());
  log.debug(`[CLEANUP] Recorded activity for user ${userId}`);
}

/**
 * Checks if user has been active recently (within submenu timeout)
 * @param {string} userId - The user ID
 * @returns {boolean} - True if user is active
 */
function isUserActive(userId) {
  const lastActivity = userActivity.get(userId);
  if (!lastActivity) return false;
  
  const timeSinceActivity = Date.now() - lastActivity;
  const activityWindow = getCleanupTimeout(MessageType.SUBMENU);
  const isActive = timeSinceActivity < activityWindow;
  
  if (isActive) {
    log.debug(`[CLEANUP] User ${userId} is active (${Math.round(timeSinceActivity / 1000)}s ago)`);
  }
  
  return isActive;
}

/**
 * Clears user activity tracking (call when flow completes)
 * @param {string} userId - The user ID
 */
function clearUserActivity(userId) {
  userActivity.delete(userId);
  log.debug(`[CLEANUP] Cleared activity for user ${userId}`);
}

/**
 * Tracks the channel for a user (simplified - no individual message tracking needed)
 * @param {string} userId - The user ID
 * @param {string} channelId - The channel ID where messages are being sent
 */
function trackUserChannel(userId, channelId) {
  userChannels.set(userId, channelId);
  log.debug(`[CLEANUP] Tracking channel ${channelId} for user ${userId}`);
}

/**
 * Cleans up ALL bot messages in the user's channel/DM (except main menu in DMs)
 * Call this when starting a new flow to clear previous flow messages
 * @param {string} userId - The user ID
 * @param {import('discord.js').Client} client - Discord client
 */
async function cleanupFlowMessages(userId, client) {
  try {
    // Try to find the channel from tracked channels
    const channelId = userChannels.get(userId);
    let channel = null;
    
    if (channelId) {
      channel = await client.channels.fetch(channelId).catch(() => null);
    }
    
    // If no tracked channel, try to find DM channel
    if (!channel) {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) {
        channel = user.dmChannel || await user.createDM().catch(() => null);
      }
    }

    if (!channel) {
      log.debug(`[CLEANUP] No channel found for user ${userId}`);
      userChannels.delete(userId);
      return;
    }

    log.info(`[CLEANUP] Cleaning all bot messages for user ${userId} in channel ${channel.id}`);

    // Fetch recent messages
    const messages = await channel.messages.fetch({ limit: config.messageFetchLimit });
    
    // Filter to bot messages, but EXCLUDE the main menu and manage requests menu
    const botMessages = messages.filter(m => 
      m.author.id === client.user.id &&
      !m.content?.includes('📌 **Welcome to the Guild Request System!**') && // Preserve main menu
      !m.content?.includes('🔨 **Manage Requests - Crafter Menu**') && // Preserve crafter menu
      !m.content?.includes('⚙️ **Manage Requests - Admin Menu**') // Preserve admin menu
    );

    if (botMessages.size > 0) {
      log.info(`[CLEANUP] Deleting ${botMessages.size} bot messages`);
      
      // Delete messages one by one with small delay
      let deletedCount = 0;
      for (const message of botMessages.values()) {
        try {
          await message.delete();
          deletedCount++;
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, config.messageDeleteDelay));
        } catch (err) {
          // Ignore if message already deleted
          if (err.code !== 10008) {
            log.debug(`[CLEANUP] Could not delete message ${message.id}: ${err.message}`);
          }
        }
      }
      
      log.info(`[CLEANUP] Deleted ${deletedCount}/${botMessages.size} bot messages for user ${userId}`);
    } else {
      log.debug(`[CLEANUP] No bot messages to clean for user ${userId}`);
    }
  } catch (err) {
    log.warn(`[CLEANUP] Error cleaning flow messages for user ${userId}: ${err.message}`);
  }
}

/**
 * Cleans up submenu messages but keeps the main menu and manage requests menu
 * Call this when navigating between submenus within manage requests
 * @param {string} userId - The user ID
 * @param {import('discord.js').Client} client - Discord client
 * @param {string[]} protectedMessageIds - Array of message IDs to preserve (optional)
 */
async function cleanupSubmenuMessages(userId, client, protectedMessageIds = []) {
  try {
    // Try to find the channel from tracked channels
    const channelId = userChannels.get(userId);
    let channel = null;
    
    if (channelId) {
      channel = await client.channels.fetch(channelId).catch(() => null);
    }
    
    // If no tracked channel, try to find DM channel
    if (!channel) {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) {
        channel = user.dmChannel || await user.createDM().catch(() => null);
      }
    }

    if (!channel) {
      log.debug(`[CLEANUP] No channel found for user ${userId}`);
      userChannels.delete(userId);
      return;
    }

    log.info(`[CLEANUP] Cleaning submenu messages for user ${userId} in channel ${channel.id}`);

    // Fetch recent messages
    const messages = await channel.messages.fetch({ limit: config.messageFetchLimit });
    
    // Filter to bot messages, EXCLUDING main menu AND manage requests menus AND material list messages AND protected message IDs
    const botMessages = messages.filter(m => {
      if (m.author.id !== client.user.id) return false;
      
      // Preserve protected message IDs (menu group)
      if (protectedMessageIds.includes(m.id)) return false;
      
      const content = m.content || '';
      
      // Preserve these messages
      if (content.includes('📌 **Welcome to the Guild Request System!**')) return false;
      if (content.includes('🔨 **Manage Requests - Crafter Menu**')) return false;
      if (content.includes('⚙️ **Manage Requests - Admin Menu**')) return false;
      
      return true;
    });

    if (botMessages.size > 0) {
      log.info(`[CLEANUP] Deleting ${botMessages.size} submenu messages`);
      
      // Delete messages one by one with small delay
      let deletedCount = 0;
      for (const message of botMessages.values()) {
        try {
          await message.delete();
          deletedCount++;
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, config.messageDeleteDelay));
        } catch (err) {
          // Ignore if message already deleted
          if (err.code !== 10008) {
            log.debug(`[CLEANUP] Could not delete message ${message.id}: ${err.message}`);
          }
        }
      }
      
      log.info(`[CLEANUP] Deleted ${deletedCount}/${botMessages.size} submenu messages for user ${userId}`);
    } else {
      log.debug(`[CLEANUP] No submenu messages to clean for user ${userId}`);
    }
  } catch (err) {
    log.warn(`[CLEANUP] Error cleaning submenu messages for user ${userId}: ${err.message}`);
  }
}

/**
 * Cleans up ALL bot messages including manage requests menus
 * Call this when re-opening manage requests to prevent duplicate menus
 * @param {string} userId - The user ID
 * @param {import('discord.js').Client} client - Discord client
 */
async function cleanupAllFlowMessages(userId, client) {
  try {
    // Try to find the channel from tracked channels
    const channelId = userChannels.get(userId);
    let channel = null;
    
    if (channelId) {
      channel = await client.channels.fetch(channelId).catch(() => null);
    }
    
    // If no tracked channel, try to find DM channel
    if (!channel) {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) {
        channel = user.dmChannel || await user.createDM().catch(() => null);
      }
    }

    if (!channel) {
      log.debug(`[CLEANUP] No channel found for user ${userId}`);
      userChannels.delete(userId);
      return;
    }

    log.info(`[CLEANUP] Cleaning ALL bot messages (including menus) for user ${userId} in channel ${channel.id}`);

    // Fetch recent messages
    const messages = await channel.messages.fetch({ limit: config.messageFetchLimit });
    
    // Filter to bot messages, preserve main menu (stays forever in permanent channels)
    const botMessages = messages.filter(m => 
      m.author.id === client.user.id &&
      !m.content?.includes('📌 **Welcome to the Guild Request System!**') // Preserve main menu
    );

    if (botMessages.size > 0) {
      log.info(`[CLEANUP] Deleting ${botMessages.size} bot messages (preserving main menu)`);
      
      // Delete messages one by one with small delay
      let deletedCount = 0;
      for (const message of botMessages.values()) {
        try {
          await message.delete();
          deletedCount++;
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, config.messageDeleteDelay));
        } catch (err) {
          // Ignore if message already deleted
          if (err.code !== 10008) {
            log.debug(`[CLEANUP] Could not delete message ${message.id}: ${err.message}`);
          }
        }
      }
      
      log.info(`[CLEANUP] Deleted ${deletedCount}/${botMessages.size} bot messages for user ${userId}`);
    } else {
      log.debug(`[CLEANUP] No bot messages to clean for user ${userId}`);
    }
  } catch (err) {
    log.warn(`[CLEANUP] Error cleaning all flow messages for user ${userId}: ${err.message}`);
  }
}

/**
 * Schedules a temporary channel to be deleted after a configured TTL.
 * If already scheduled, the existing timer is replaced (preventing duplicates).
 * @param {import('discord.js').TextChannel} channel The channel to monitor.
 * @param {number} customDelay Optional custom delay in ms (defaults to submenu timeout).
 */
function scheduleChannelDeletion(channel, customDelay = null) {
  if (!channel || !channel.id) return;

  const delay = customDelay !== null ? customDelay : getCleanupTimeout(MessageType.SUBMENU);

  // Cancel any existing timer for this channel to prevent duplicates
  if (activeTimers.has(channel.id)) {
    clearTimeout(activeTimers.get(channel.id));
    log.debug(`[CLEANUP] Replaced existing deletion timer for channel ${channel.id}`);
  }

  const timer = setTimeout(async () => {
    try {
      await channel.delete('🧹 Auto-cleanup: Request timed out or completed.');
      log.info(`[CLEANUP] Auto-deleted temp channel ${channel.name} (${channel.id})`);
    } catch (err) {
      // Ignore if channel is already deleted
      if (err.code !== 10003) {
        log.error(`[CLEANUP] Failed to auto-delete ${channel.name}: ${err.message}`);
      }
    } finally {
      activeTimers.delete(channel.id);
    }
  }, delay);

  activeTimers.set(channel.id, timer);
  log.info(`[CLEANUP] Scheduled channel ${channel.name} (${channel.id}) for deletion in ${delay / 1000}s`);
}

/**
 * Cancels a previously scheduled channel deletion.
 * @param {string} channelId The ID of the channel to cancel monitoring for.
 */
function cancelChannelDeletion(channelId) {
  if (activeTimers.has(channelId)) {
    clearTimeout(activeTimers.get(channelId));
    activeTimers.delete(channelId);
    log.info(`[CLEANUP] Cancelled scheduled deletion for channel ${channelId}`);
    return true;
  }
  return false;
}

/**
 * Deletes all messages sent by the bot in a DM channel, EXCEPT the main menu.
 * Note: Bots can only delete their OWN messages in DMs, not user messages.
 * @param {import('discord.js').DMChannel} dmChannel The DM channel to clean.
 * @param {import('discord.js').Client} client The Discord client instance.
 */
async function cleanupDMMessages(dmChannel, client) {
    if (!dmChannel || !client.user) return;

    try {
        // Fetch recent messages
        const messages = await dmChannel.messages.fetch({ limit: config.messageFetchLimit });
        
        // Delete ALL bot messages in DMs/temp channels (including main menu) after timeout
        // This prevents DM buildup and forces users back to guild
        const botMessages = messages.filter(m => m.author.id === client.user.id);

        if (botMessages.size > 0) {
            log.info(`[CLEANUP] Cleaning ${botMessages.size} bot messages from DM/temp channel (including main menu)`);
            
            // Bulk delete is not available in DMs, so delete one by one with small delay
            for (const message of botMessages.values()) {
                try {
                    await message.delete();
                    // Small delay to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, config.messageDeleteDelay));
                } catch (err) {
                    // Ignore if message already deleted or doesn't exist
                    if (err.code !== 10008) {
                        log.debug(`[CLEANUP] Could not delete message ${message.id}: ${err.message}`);
                    }
                }
            }
            log.info(`[CLEANUP] Successfully cleaned ALL messages (DM/temp channel cleanup)`);
        } else {
            log.debug(`[CLEANUP] No bot messages to clean in DM/temp channel`);
        }
    } catch (err) {
        log.warn(`[CLEANUP] Could not clean up DM messages: ${err.message}`);
    }
}

/**
 * Schedules DM message cleanup after a custom delay.
 * Only executes if user is not active when timer fires.
 * Prevents duplicate timers for the same user.
 * Respects hierarchy cleanup protocol via cleanupType:
 *   - 'submenu': cleans hierarchy levels 3+ (preserves levels 1-2) when hierarchy exists
 *   - 'completion': performs full DM cleanup (all bot messages in DM)
 * timeoutType controls reschedule timing when user is still active.
 * @param {import('discord.js').DMChannel} dmChannel The DM channel to clean.
 * @param {import('discord.js').Client} client The Discord client instance.
 * @param {number} delay Delay in milliseconds before cleanup.
 * @param {string} userId The user ID to track activity.
 * @param {'submenu'|'completion'} [cleanupType='submenu'] Cleanup behavior mode.
 * @param {'primaryMenu'|'submenu'|'completion'} [timeoutType=MessageType.SUBMENU] Which timeout category to use on reschedule if user is active.
 */
function scheduleDMCleanup(dmChannel, client, delay, userId, cleanupType = 'submenu', timeoutType = MessageType.SUBMENU) {
    if (!dmChannel || !client) return;

    // Use userId-based timer ID to prevent duplicates
    const timerId = `dm_cleanup_${userId}`;
    
    // Cancel existing timer for this user to prevent parallel timers
    if (activeTimers.has(timerId)) {
        clearTimeout(activeTimers.get(timerId));
        log.debug(`[CLEANUP] Replaced existing cleanup timer for user ${userId}`);
    }
    
    const timer = setTimeout(async () => {
        // Only cleanup if user is NOT active (prevents mid-flow cleanup)
        if (!isUserActive(userId)) {
        log.info(`[CLEANUP] Executing DM cleanup (${cleanupType}) for ${dmChannel.recipient?.tag || 'user'} (inactive)`);

        try {
          if (cleanupType === 'submenu') {
            // Hierarchy-aware cleanup first, otherwise use submenu cleanup filter
            if (menuHierarchy.has(userId)) {
              await cleanupFromLevel(userId, client, 2);
              log.debug(`[CLEANUP] Submenu timeout: cleaned levels 2+ for user ${userId}`);
            } else {
              await cleanupSubmenuMessages(userId, client);
              log.debug('[CLEANUP] Submenu timeout: no hierarchy found, ran submenu cleanup filter');
            }
          } else {
            // completion: full DM cleanup, removes all bot messages in DM including primary menu
            await cleanupDMMessages(dmChannel, client);
            log.debug(`[CLEANUP] Completion timeout: full DM cleanup executed for user ${userId}`);
          }
        } catch (err) {
          log.warn(`[CLEANUP] Error during DM cleanup: ${err.message}`);
        } finally {
          clearUserActivity(userId);
        }
        } else {
        log.info(`[CLEANUP] Skipped DM cleanup for ${dmChannel.recipient?.tag || 'user'} (user still active)`);
        // Reschedule with the same cleanupType and the appropriate timeout bucket
        const nextDelay = timeoutType === MessageType.PRIMARY_MENU
          ? getCleanupTimeout(MessageType.PRIMARY_MENU)
          : timeoutType === MessageType.COMPLETION
          ? getCleanupTimeout(MessageType.COMPLETION)
          : getCleanupTimeout(MessageType.SUBMENU);
        scheduleDMCleanup(dmChannel, client, nextDelay, userId, cleanupType, timeoutType);
        }
        activeTimers.delete(timerId);
    }, delay);

    activeTimers.set(timerId, timer);
    log.info(`[CLEANUP] Scheduled DM cleanup (${cleanupType}/${timeoutType}) for ${dmChannel.recipient?.tag || 'user'} in ${delay / 1000}s`);
}

/**
 * Tracks a message at a specific hierarchy level
 * @param {string} userId - The user ID
 * @param {number} level - The hierarchy level (1=header, 2=profession menu, 3=submenu, 4=output)
 * @param {string} messageId - The message ID to track
 */
function trackMenuMessage(userId, level, messageId) {
  if (!menuHierarchy.has(userId)) {
    menuHierarchy.set(userId, new Map());
  }
  
  const userLevels = menuHierarchy.get(userId);
  if (!userLevels.has(level)) {
    userLevels.set(level, []);
  }
  
  userLevels.get(level).push(messageId);
  log.debug(`[CLEANUP] Tracked message ${messageId} at level ${level} for user ${userId}`);
}

/**
 * Cleans up all messages at or above a specific hierarchy level
 * @param {string} userId - The user ID
 * @param {import('discord.js').Client} client - Discord client
 * @param {number} fromLevel - Clean this level and all deeper levels
 */
async function cleanupFromLevel(userId, client, fromLevel) {
  try {
    const userLevels = menuHierarchy.get(userId);
    if (!userLevels) {
      log.debug(`[CLEANUP] No hierarchy found for user ${userId}`);
      return;
    }
    
    const channelId = userChannels.get(userId);
    if (!channelId) {
      log.debug(`[CLEANUP] No channel found for user ${userId}`);
      return;
    }
    
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      log.debug(`[CLEANUP] Could not fetch channel ${channelId}`);
      return;
    }
    
    let deletedCount = 0;
    
    // Clean all levels >= fromLevel
    for (const [level, messageIds] of userLevels.entries()) {
      if (level >= fromLevel) {
        log.debug(`[CLEANUP] Cleaning level ${level} (${messageIds.length} messages)`);
        
        for (const messageId of messageIds) {
          try {
            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (message) {
              await message.delete();
              deletedCount++;
              await new Promise(resolve => setTimeout(resolve, config.messageDeleteDelay));
            }
          } catch (err) {
            if (err.code !== 10008) { // Ignore "Unknown Message"
              log.debug(`[CLEANUP] Could not delete message ${messageId}: ${err.message}`);
            }
          }
        }
        
        // Remove this level from tracking
        userLevels.delete(level);
      }
    }
    
    log.info(`[CLEANUP] Deleted ${deletedCount} messages from level ${fromLevel}+ for user ${userId}`);
  } catch (err) {
    log.warn(`[CLEANUP] Error cleaning from level ${fromLevel}: ${err.message}`);
  }
}

/**
 * Clears all menu hierarchy tracking for a user
 * @param {string} userId - The user ID
 */
function clearMenuHierarchy(userId) {
  menuHierarchy.delete(userId);
  log.debug(`[CLEANUP] Cleared menu hierarchy for user ${userId}`);
}

/**
 * Clears all in-memory tracking data (call on bot startup)
 * This handles orphaned tracking from previous sessions
 */
function clearAllTracking() {
  const userCount = userChannels.size;
  const hierarchyCount = menuHierarchy.size;
  const timerCount = activeTimers.size;
  const activityCount = userActivity.size;
  
  userChannels.clear();
  menuHierarchy.clear();
  userActivity.clear();
  
  // Cancel all active timers
  for (const timer of activeTimers.values()) {
    clearTimeout(timer);
  }
  activeTimers.clear();
  
  log.info(`[CLEANUP] Cleared all tracking: ${userCount} channels, ${hierarchyCount} hierarchies, ${timerCount} timers, ${activityCount} activities`);
}

module.exports = {
  scheduleChannelDeletion,
  cancelChannelDeletion,
  cleanupDMMessages,
  scheduleDMCleanup,
  recordUserActivity,
  isUserActive,
  clearUserActivity,
  trackUserChannel,
  cleanupFlowMessages,
  MessageType,
  getCleanupTimeout,
  cleanupSubmenuMessages,
  cleanupAllFlowMessages,
  trackMenuMessage,
  cleanupFromLevel,
  clearMenuHierarchy,
  clearAllTracking
};
