// interactions/shared/manageCraftsFlow.js
const { ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../../utils/database');
const config = require('../../config/config.js');
const { isAdmin, getUserProfessionRoles } = require('../../utils/permissionChecks');
const { resolveResponseChannel } = require('../../utils/requestChannel');
const { getNavigationMessage } = require('../../utils/navigationHelper');
const cleanupService = require('../../utils/cleanupService');
const { ensureDMMenu } = require('../../utils/dmMenu');
const { ChannelType } = require('discord.js');
const log = require('../../utils/logWriter');
const professionLoader = require('../../utils/professionLoader');

/**
 * Helper to get guild member from interaction (works in both DM and guild contexts)
 */
async function getGuildMember(interaction, client) {
  if (interaction.member) {
    return interaction.member;
  }
  
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const member = await guild.members.fetch(interaction.user.id);
    return member;
  } catch (err) {
    log.error('[MANAGE_CRAFTS] Failed to fetch guild member:', err);
    return null;
  }
}

/**
 * Helper to determine material provision status for a request
 * Returns emoji indicator for Core guild crafting or user-provided materials
 * @param {Object} request - Request object with provides_materials and provided_materials_json
 * @returns {string} Empty string, "🛡️" for full guild craft, "🔷" for partial guild craft, or "📦" for user materials
 */
function getMaterialIndicator(request) {
  if (!request.provides_materials) {
    // User chose "Guild Craft" - no materials provided (Core member)
    return '🛡️';
  }
  
  // Check if user provided materials (Core or non-Core)
  try {
    const providedMats = request.provided_materials_json ? JSON.parse(request.provided_materials_json) : {};
    const requiredPerUnit = request.materials_json ? JSON.parse(request.materials_json) : {};
    const qtyRequested = parseInt(request.quantity_requested || request.quantity || 1, 10);
    // Multiply per-unit required amounts by requested quantity
    const requiredMats = {};
    for (const [mat, perQty] of Object.entries(requiredPerUnit)) {
      requiredMats[mat] = (parseInt(perQty, 10) || 0) * qtyRequested;
    }
    
    const providedValues = Object.values(providedMats);
    const hasAnyProvided = providedValues.some(qty => qty > 0);
    
    if (hasAnyProvided) {
      // Check if partial or full provision
      const allFull = Object.entries(requiredMats).every(([mat, req]) => (providedMats[mat] || 0) >= req);
      
      if (allFull) {
        return '📦';  // Full materials provided (Core or non-Core)
      } else {
        return '🔷';  // Partial materials (Core member only - non-Core can't do this)
      }
    }
  } catch (err) {
    log.debug('[MATERIAL_INDICATOR] Failed to parse materials:', err);
  }
  
  return '';  // Default: no indicator
}

/**
 * Helper to send notifications to requesters when status changes
 */
async function notifyRequester(client, requesterId, message) {
  if (!config.notificationSettings.enabled) return;
  
  try {
    const user = await client.users.fetch(requesterId);
    await user.send(message);
    log.info(`[MANAGE_CRAFTS] Notification sent to user ${requesterId}`);
  } catch (err) {
    log.error(`[MANAGE_CRAFTS] Failed to send notification to user ${requesterId}:`, err);
  }
}

/**
 * Main entry point for Manage Requests - shows crafter or admin menu
 */
async function handleManageRequestsMain(interaction, client) {
  const member = await getGuildMember(interaction, client);
  const admin = isAdmin(member);
  const roles = getUserProfessionRoles(member);

  if (!admin && roles.length === 0) {
    return interaction.reply({
      content: '❌ You do not have permission to manage crafting requests.',
      flags: 1 << 6
    });
  }

  const userId = interaction.user.id;
  
  // ** DEFER IMMEDIATELY to prevent timeout **
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }
  
  const channel = await resolveResponseChannel(interaction, client);
  // NOTE: resolveResponseChannel already calls ensureDMMenu in DM mode, no need to call again
  
  // ** TRACK: Remember this channel BEFORE cleanup so cleanup knows where to clean **
  cleanupService.trackUserChannel(userId, channel.id);
  
  // ** CLEANUP: Clear ALL other Level 1 flows (preserves only primary menu) **
  await cleanupService.cleanupAllFlowMessages(userId, client);
  cleanupService.clearMenuHierarchy(userId);
  
  // ** CLEAR SESSION: Remove old profession selection when reopening flow **
  await db.deleteTempSession(`manage_profession_${userId}`);

  if (admin) {
    await showAdminMenu(interaction, client, channel, true); // Pass true since already deferred
  } else {
    // Always start fresh - no profession pre-selected
    // User will see selector if multiple professions, or auto-select if only one
    await showCrafterMenu(interaction, client, channel, roles, true, null); // Pass true since already deferred
  }
}

/**
 * Shows the crafter menu with their work options
 * @param {boolean} alreadyHandled - If true, skip interaction response (interaction already deferred/replied)
 */
async function showCrafterMenu(interaction, client, channel, professionRoles, alreadyHandled = false, selectedProfession = null) {
  const userId = interaction.user.id;
  const member = await getGuildMember(interaction, client);
  const isAdminUser = isAdmin(member);
  
  // If user has multiple professions and none selected, show profession selector FIRST
  // (before acknowledging interaction)
  if (professionRoles.length > 1 && !selectedProfession) {
    return showProfessionSelector(interaction, client, channel, professionRoles, alreadyHandled);
  }
  
  // Defer interaction immediately to prevent timeout
  if (!alreadyHandled) {
    const confirmation = getNavigationMessage(interaction, channel);
    if (confirmation) {
      await interaction.reply({ content: confirmation, flags: 1 << 6 });
    } else {
      await interaction.deferUpdate();
    }
  }
  
  // ** CLEANUP: Remove old Level 2 messages before creating new ones **
  // This prevents menu duplication when returning from submenu actions
  await cleanupService.cleanupFromLevel(userId, client, 2);
  
  // If only one profession, auto-select it
  const activeProfession = selectedProfession || professionRoles[0];
  
  // Get pending task count for THIS profession only
  const myWork = await db.getInProgressRequestsByUser(userId);
  const myWorkForProfession = myWork.filter(req => req.profession === activeProfession);
  const pendingCount = myWorkForProfession.length;
  
  // Get unassigned request count for this profession
  const unassignedRequests = await db.getOpenRequestsByProfession(activeProfession);
  const unassignedCount = unassignedRequests.length;
  
  // ** HEADER MESSAGE: Show Change Profession button OR Back to Admin button **
  let headerMsg = null;
  const headerButtons = [];
  
  // Add Change Profession button if user has multiple professions
  if (professionRoles.length > 1) {
    headerButtons.push(
      new ButtonBuilder()
        .setCustomId('manage_crafts:change_profession')
        .setLabel('🔄 Change Profession')
        .setStyle(ButtonStyle.Primary)
    );
  }
  
  // Add Back to Admin button if user is an admin
  if (isAdminUser) {
    headerButtons.push(
      new ButtonBuilder()
        .setCustomId('manage_crafts:switch_to_admin')
        .setLabel('Back to Admin Menu')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⚙️')
    );
  }
  
  // Only show header if there are buttons to display
  if (headerButtons.length > 0) {
    const headerRow = new ActionRowBuilder().addComponents(headerButtons);
    
    headerMsg = await channel.send({
      content: `🔨 **Manage Requests**`,
      components: [headerRow]
    });
    
    // Track at level 2 (header is part of the anchor menu)
    cleanupService.trackMenuMessage(userId, 2, headerMsg.id);
  }
  
  // ** PROFESSION MENU: Main content with stats and action buttons **
  const professionName = activeProfession.charAt(0).toUpperCase() + activeProfession.slice(1);
  let content = `# ${professionName} Menu\n\n`;
  content += `📋 **Your Pending Tasks:** ${pendingCount}\n`;
  content += `✋ **Unassigned ${professionName} Requests:** ${unassignedCount}\n\n`;
  content += '─────────────────────────\n\n';

  // Row 1: My Claimed Requests, Material Lists (informational actions)
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('manage_crafts:view_my_work')
      .setLabel('My Claimed Requests')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📋'),
    new ButtonBuilder()
      .setCustomId('manage_crafts:material_lists')
      .setLabel('Material Lists')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📦')
  );

  // Row 2: Unclaimed Requests (standalone action)
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('manage_crafts:claim_request')
      .setLabel('Unclaimed Requests')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✋')
  );

  // Row 3: Complete Requests, Release Request (completion actions)
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('manage_crafts:mark_complete')
      .setLabel('Complete Requests')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId('manage_crafts:release_request')
      .setLabel('Release Request')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔓')
  );

  const professionMsg = await channel.send({
    content,
    components: [row1, row2, row3]
  });
  
  // Track at level 2 (profession menu)
  cleanupService.trackMenuMessage(userId, 2, professionMsg.id);
  cleanupService.trackUserChannel(userId, channel.id);
  
  // Store selected profession in session for claim/complete operations
  await db.storeTempSession(`manage_profession_${userId}`, userId, { selected_profession: activeProfession });

  // Schedule cleanup if in DM mode (SUBMENU = profession menu)
  if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleDMCleanup(
      channel,
      client,
      timeout,
      userId,
      'submenu',
      cleanupService.MessageType.SUBMENU
    );
  }
}

/**
 * Shows profession selector when user has multiple professions
 */
async function showProfessionSelector(interaction, client, channel, professionRoles, alreadyHandled = false) {
  const userId = interaction.user.id;
  
  if (!alreadyHandled) {
    const confirmation = getNavigationMessage(interaction, channel);
    if (confirmation) {
      await interaction.reply({ content: confirmation, flags: 1 << 6 });
    } else {
      await interaction.deferUpdate();
    }
  }
  
  let content = '🔨 **Select Your Profession**\n\n';
  content += 'You have access to multiple professions. Choose which one to manage:\n';
  
  const buttons = [];
  for (const profession of professionRoles) {
    // Get unassigned count for each profession
    const unassigned = await db.getOpenRequestsByProfession(profession);
    const professionName = profession.charAt(0).toUpperCase() + profession.slice(1);
    
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`manage_crafts:select_profession:${profession}`)
        .setLabel(`${professionName} (${unassigned.length} unassigned)`)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔧')
    );
  }
  
  // Split into rows of max 5 buttons each
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  
  const msg = await channel.send({
    content,
    components: rows
  });
  
  // Track at Level 2 (profession selector replaces profession menu temporarily)
  cleanupService.trackMenuMessage(userId, 2, msg.id);
  cleanupService.trackUserChannel(userId, channel.id);
  
  // Schedule cleanup if in DM mode (SUBMENU = profession selector)
  if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleDMCleanup(
      channel,
      client,
      timeout,
      userId,
      'submenu',
      cleanupService.MessageType.SUBMENU
    );
  }
}

/**
 * Shows the admin menu with oversight options
 */
async function showAdminMenu(interaction, client, channel, alreadyDeferred = false) {
  const userId = interaction.user.id;
  const member = await getGuildMember(interaction, client);
  const roles = getUserProfessionRoles(member);

  // Defer interaction if not already deferred
  if (!alreadyDeferred) {
    const confirmation = getNavigationMessage(interaction, channel);
    if (confirmation) {
      await interaction.reply({ content: confirmation, flags: 1 << 6 });
    } else {
      await interaction.deferUpdate();
    }
  }

  // ** CLEANUP: Remove old Level 2 messages before creating new ones **
  // This prevents menu duplication when returning from submenu actions
  await cleanupService.cleanupFromLevel(userId, client, 2);

  let content = '⚙️ **Manage Requests - Admin Menu**\n\n';
  content += 'Administrative oversight and management options:\n\n';
  content += '**Search Tools:**\n';
  content += '• Request Lookup - Find specific request by ID\n';
  content += '• Audit Log Search - All requests (newest first) with character search\n\n';
  content += '**Material Icons:** 🛡️ Guild Craft (Core Full) | 🔷 Guild Craft (Core Partial) | 📦 User Materials\n';

  const buttons = [
    new ButtonBuilder()
      .setCustomId('manage_crafts:admin_summary')
      .setLabel('Profession Summary')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📊'),
    new ButtonBuilder()
      .setCustomId('manage_crafts:admin_by_profession')
      .setLabel('View by Profession')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔧'),
    new ButtonBuilder()
      .setCustomId('manage_crafts:admin_by_crafter')
      .setLabel('View by Crafter')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('👤'),
    new ButtonBuilder()
      .setCustomId('manage_crafts:admin_lookup')
      .setLabel('Request Lookup')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔍'),
    new ButtonBuilder()
      .setCustomId('manage_crafts:admin_audit')
      .setLabel('Audit Log Search')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📜')
  ];

  const rows = [
    new ActionRowBuilder().addComponents(buttons.slice(0, 3)),
    new ActionRowBuilder().addComponents(buttons.slice(3, 5))
  ];
  
  // Add "Switch to Crafter Menu" button if admin has profession roles
  if (roles.length > 0) {
    const crafterButton = new ButtonBuilder()
      .setCustomId('manage_crafts:switch_to_crafter')
      .setLabel('Switch to Crafter Menu')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🔨');
    
    rows.push(new ActionRowBuilder().addComponents(crafterButton));
  }

  const msg = await channel.send({
    content,
    components: rows
  });
  
  // Track at Level 2 (admin menu - ANCHOR POINT, same as profession menu)
  cleanupService.trackMenuMessage(userId, 2, msg.id);
  cleanupService.trackUserChannel(userId, channel.id);

  // Schedule cleanup if in DM mode (SUBMENU = admin menu)
  if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleDMCleanup(
      channel,
      client,
      timeout,
      userId,
      'submenu',
      cleanupService.MessageType.SUBMENU
    );
  }
}

/**
 * View My Work - Shows crafter's claimed requests
 */
async function handleViewMyWork(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 3+ (keep header and profession menu)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  cleanupService.trackUserChannel(userId, channel.id);
  
  // Get selected profession from session
  const session = await db.getTempSession(`manage_profession_${userId}`);
  const selectedProfession = session?.selected_profession;
  
  // Get all work and filter by profession if selected
  let myWork = await db.getInProgressRequestsByUser(userId);
  if (selectedProfession) {
    myWork = myWork.filter(req => req.profession === selectedProfession);
  }

  // Separate active and cancelled requests
  const activeWork = myWork.filter(req => req.status !== 'denied');
  const cancelledWork = myWork.filter(req => req.status === 'denied');
  
  let content = '📋 **My Claimed Requests**\n\n';
  if (selectedProfession) {
    content = `📋 **My Claimed ${selectedProfession.charAt(0).toUpperCase() + selectedProfession.slice(1)} Requests**\n\n`;
  }
  
  if (activeWork.length === 0 && cancelledWork.length === 0) {
    content += 'You have no active requests at the moment.\n';
  } else {
    // Show active requests first
    if (activeWork.length > 0) {
      for (let i = 0; i < activeWork.length; i++) {
        const req = activeWork[i];
        const taskNumber = i + 1;
        const materialIndicator = getMaterialIndicator(req);
        const qtyRequested = parseInt(req.quantity_requested || req.quantity || 1, 10) || 1;
        const qtySuffix = qtyRequested > 1 ? ` x${qtyRequested}` : '';
        const requestLabel = `${req.request_name}${qtySuffix}`;
        const statusLabel = req.status === 'in_progress' ? 'In Progress' : req.status === 'claimed' ? 'Claimed' : req.status;
        content += `**${taskNumber}.** ${materialIndicator ? materialIndicator + ' ' : ''}For: **${req.character}** | ${requestLabel} | Status: **${statusLabel}**\n`;
      }
    }
    
    // Show cancelled requests separately with acknowledgment info
    if (cancelledWork.length > 0) {
      content += '\n**Recently Cancelled:**\n';
      for (let i = 0; i < cancelledWork.length; i++) {
        const req = cancelledWork[i];
        const taskNumber = i + 1;
        const qtyRequested2 = parseInt(req.quantity_requested || req.quantity || 1, 10) || 1;
        const qtySuffix2 = qtyRequested2 > 1 ? ` x${qtyRequested2}` : '';
        const requestLabel = `${req.request_name}${qtySuffix2}`;
        content += `**${taskNumber}.** ~~For: **${req.character}** | ${requestLabel}~~ | **❌ Cancelled**`;
        if (req.deny_reason) {
          content += ` — Reason: ${req.deny_reason}`;
        }
        content += '\n';
        
        // Add audit log entry and clear claimed_by so it doesn't show up next time
        let auditLog = [];
        if (req.audit_log) {
          try {
            auditLog = JSON.parse(req.audit_log);
          } catch (e) {
            log.warn('[MANAGE_CRAFTS] Failed to parse audit log for request', req.id);
          }
        }
        
        auditLog.push({
          action: 'claim_released',
          by: interaction.user.id,
          at: new Date().toISOString(),
          reason: 'Acknowledged cancellation'
        });
        
        db.run(
          `UPDATE requests SET claimed_by = NULL, claimed_by_name = NULL, audit_log = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [JSON.stringify(auditLog), req.id]
        ).catch(err => log.error('[MANAGE_CRAFTS] Failed to clear cancelled request claim:', err));
      }
      content += '\n_These cancelled requests will no longer appear in your claimed list._\n';
    }
  }

  const msg = await channel.send({ content });
  
  // Track at Level 3 (submenu display)
  cleanupService.trackMenuMessage(userId, 3, msg.id);
  
  // Schedule cleanup if user becomes inactive (SUBMENU = viewing list)
  if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleDMCleanup(
      channel,
      client,
      timeout,
      userId,
      'submenu',
      cleanupService.MessageType.SUBMENU
    );
  }
  
  await interaction.deferUpdate();
}

/**
 * Claim Request - Shows dropdown of available requests
 */
async function handleClaimRequest(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 3+ (keep header and profession menu)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  cleanupService.trackUserChannel(userId, channel.id);
  
  const member = await getGuildMember(interaction, client);
  const professionRoles = getUserProfessionRoles(member);

  if (professionRoles.length === 0) {
    return interaction.reply({
      content: '❌ You do not have any profession roles.',
      flags: 1 << 6
    });
  }

  // Check if user has a selected profession in session
  const session = await db.getTempSession(`manage_profession_${userId}`);
  const selectedProfession = session?.selected_profession;
  
  // Get open requests - filter by selected profession if available
  let allOpenRequests = [];
  if (selectedProfession && professionRoles.includes(selectedProfession)) {
    // User has selected a specific profession
    const requests = await db.getOpenRequestsByProfession(selectedProfession);
    allOpenRequests = requests;
  } else {
    // Show all professions user has access to
    for (const profession of professionRoles) {
      const requests = await db.getOpenRequestsByProfession(profession);
      allOpenRequests = allOpenRequests.concat(requests);
    }
  }

  if (allOpenRequests.length === 0) {
    const content = '❌ No open requests available for your professions.';
    const msg = await channel.send({ content });
    
    // Track at Level 3 (empty message)
    cleanupService.trackMenuMessage(userId, 3, msg.id);
    
    // Schedule cleanup if in DM mode
    if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
      const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
      cleanupService.scheduleDMCleanup(
        channel,
        client,
        timeout,
        userId,
        'submenu',
        cleanupService.MessageType.SUBMENU
      );
    }
    
    return interaction.deferUpdate();
  }

  // Build multi-select dropdown with up to 25 requests
  const options = allOpenRequests.slice(0, 25).map((req, index) => {
    const materialIndicator = getMaterialIndicator(req);
    const qtyRequested = parseInt(req.quantity_requested || req.quantity || 1, 10) || 1;
    const qtySuffix = qtyRequested > 1 ? ` x${qtyRequested}` : '';
    const label = `${index + 1}. ${req.character} | ${req.request_name}${qtySuffix}`;
    const professionCap = req.profession.charAt(0).toUpperCase() + req.profession.slice(1);
    const qtyDesc = qtyRequested > 1 ? ` | Qty: ${qtyRequested}` : '';
    const description = materialIndicator 
      ? `${professionCap} - ${req.gear_slot} ${materialIndicator === '🛡️' ? '[Guild Craft]' : '[User Materials]'}${qtyDesc}`
      : `${professionCap} - ${req.gear_slot}${qtyDesc}`;
    
    return {
      label,
      value: `claim_${req.id}`,
      description,
      emoji: materialIndicator || '📋'
    };
  });

  const dropdown = new StringSelectMenuBuilder()
    .setCustomId('manage_crafts:claim_dropdown')
    .setPlaceholder('Select requests to claim (can select multiple)')
    .setMinValues(1)
    .setMaxValues(Math.min(options.length, 25))
    .addOptions(options);

  const row1 = new ActionRowBuilder().addComponents(dropdown);

  const msg = await channel.send({
    content: `📋 **Claim Requests**\n\n**How to use:**\n• Click the dropdown menu below\n• Select one or more requests (click multiple items to select)\n• Press **Enter** or click outside to submit your selection\n\n**Icons:** 🛡️ Guild Craft (Core Full) | 🔷 Guild Craft (Core Partial) | 📦 User Materials\n\nYou can claim multiple requests at once:`,
    components: [row1]
  });

  // Track at Level 3 (submenu dropdown)
  cleanupService.trackMenuMessage(userId, 3, msg.id);

  // Schedule cleanup if user becomes inactive (SUBMENU = dropdown selection)
  if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleDMCleanup(
      channel,
      client,
      timeout,
      userId,
      'submenu',
      cleanupService.MessageType.SUBMENU
    );
  }

  await interaction.deferUpdate();
}

/**
 * Handle claim dropdown selection (supports multiple selections)
 */
async function handleClaimDropdown(interaction, client) {
  const selectedValues = interaction.values; // Array of selected values
  const requestIds = selectedValues.map(val => parseInt(val.replace('claim_', '')));
  const userId = interaction.user.id;
  // Prefer guild nickname/display name over global username for notifications and storage
  const member = await getGuildMember(interaction, client);
  const userName = (member && (member.nickname || member.displayName)) || interaction.member?.displayName || interaction.user.username;
  const channel = await resolveResponseChannel(interaction, client);

  // Defer immediately to prevent timeout
  await interaction.deferUpdate();

  try {
    let successCount = 0;
    let failedClaims = [];
    const claimedRequests = [];

    // Claim each selected request
    for (const requestId of requestIds) {
      try {
        // Claim the request (automatically sets to in_progress)
        await db.claimRequest(requestId, userId, userName);

        // Get request details for notification
        const request = await db.getRequestById(requestId);
        claimedRequests.push(request);
        
        // Send notification to requester
        if (config.notificationSettings.notifyOnClaim) {
          const notifMessage = `✅ Your request **#${requestId}** for **${request.character}** has been claimed by **${userName}**!\n\n` +
            `**Profession:** ${request.profession}\n` +
            `**Request:** ${request.request_name} to ${request.gear_slot}`;
          await notifyRequester(client, request.user_id, notifMessage);
        }
        
        successCount++;
      } catch (err) {
        log.error(`[MANAGE_CRAFTS] Failed to claim request ${requestId}:`, err);
        failedClaims.push(requestId);
      }
    }

    // Build confirmation message
    let content = `✅ Successfully claimed **${successCount}** request(s)!\n\n`;
    
    if (claimedRequests.length > 0) {
      content += 'Claimed:\n';
      for (const req of claimedRequests) {
        const qtyRequested = parseInt(req.quantity_requested || req.quantity || 1, 10) || 1;
        const qtySuffix = qtyRequested > 1 ? ` x${qtyRequested}` : '';
        content += `• **#${req.id}** ${req.character} - ${req.request_name}${qtySuffix}\n`;
      }
    }
    
    if (failedClaims.length > 0) {
      content += `\n❌ Failed to claim: ${failedClaims.join(', ')}`;
    }

    // Show confirmation and auto-return to menu
    const confirmMsg = await channel.send({ content });
    cleanupService.trackMenuMessage(userId, 4, confirmMsg.id);
    
    // Small delay to let user read the confirmation
    await new Promise(resolve => setTimeout(resolve, config.confirmationMessageDelay));
    
    // Clear Level 3+ (dropdown and confirmation) - keeps header and profession menu
    await cleanupService.cleanupFromLevel(userId, client, 3);
    
    // Re-show crafter menu (interaction already deferred) with preserved profession
    const session = await db.getTempSession(`manage_profession_${userId}`);
    const selectedProfession = session?.selected_profession;
    const member = await getGuildMember(interaction, client);
    const roles = getUserProfessionRoles(member);
    await showCrafterMenu(interaction, client, channel, roles, true, selectedProfession);
    
  } catch (err) {
    log.error('[MANAGE_CRAFTS] Failed to process claims:', err);
    // Can't reply now since we already deferred
    await channel.send({
      content: `❌ Failed to claim requests: ${err.message}`
    }).catch(() => {});
  }
}

/**
 * Mark Complete - Shows dropdown of in-progress requests with character grouping
 */
async function handleMarkComplete(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 3+ (keep header and profession menu)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  cleanupService.trackUserChannel(userId, channel.id);

  // Get selected profession from session
  const session = await db.getTempSession(`manage_profession_${userId}`);
  const selectedProfession = session?.selected_profession;
  
  // Get all work and filter by profession if selected, exclude denied
  let myWork = await db.getInProgressRequestsByUser(userId);
  myWork = myWork.filter(req => req.status !== 'denied'); // Exclude cancelled requests
  if (selectedProfession) {
    myWork = myWork.filter(req => req.profession === selectedProfession);
  }

  if (myWork.length === 0) {
    const content = '\u274c You have no active requests to complete.';
    const msg = await channel.send({ content });
    
    // Track at Level 3 (empty message)
    cleanupService.trackMenuMessage(userId, 3, msg.id);
    
    // Schedule cleanup if user becomes inactive (SUBMENU = empty message)
    if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
      const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
      cleanupService.scheduleDMCleanup(
        channel,
        client,
        timeout,
        userId,
        'submenu',
        cleanupService.MessageType.SUBMENU
      );
    }
    
    return interaction.deferUpdate();
  }

  // Build dropdown
  const options = myWork.map((req, index) => ({
    label: `${index + 1}. ${req.character} | ${req.request_name}`,
    value: `complete_${req.id}`,
    description: `${req.profession.charAt(0).toUpperCase() + req.profession.slice(1)} - ${req.gear_slot}`,
    emoji: '✅'
  }));

  const dropdown = new StringSelectMenuBuilder()
    .setCustomId('manage_crafts:complete_dropdown')
    .setPlaceholder('Select a request to mark complete')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(dropdown);

  const msg = await channel.send({
    content: `✅ **Complete Requests**\n\n**How to use:**\n• Click the dropdown menu below\n• Select a request to mark as complete\n\nChoose a request:`,
    components: [row]
  });

  // Track at Level 3 (submenu dropdown)
  cleanupService.trackMenuMessage(userId, 3, msg.id);

  // Schedule cleanup if user becomes inactive (SUBMENU = dropdown selection)
  if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleDMCleanup(
      channel,
      client,
      timeout,
      userId,
      'submenu',
      cleanupService.MessageType.SUBMENU
    );
  }

  await interaction.deferUpdate();
}

/**
 * Handle complete dropdown selection - check for other requests for same character
 */
async function handleCompleteDropdown(interaction, client) {
  const selectedValue = interaction.values[0];
  const requestId = parseInt(selectedValue.replace('complete_', ''));
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);

  try {
    // Get the request being completed
    const request = await db.getRequestById(requestId);
    
    // Get selected profession from session
    const session = await db.getTempSession(`manage_profession_${userId}`);
    const selectedProfession = session?.selected_profession;
    
    // Check if request was cancelled
    if (request.status === 'denied') {
      const reason = request.deny_reason || 'No reason provided';
      await interaction.update({
        content: `❌ This request has been cancelled and cannot be completed.\n**Reason:** ${reason}`,
        components: []
      });
      return;
    }
    
    // Check for other pending requests for the same character by this crafter
    let myWork = await db.getInProgressRequestsByUser(userId);
    
    // Filter by profession if selected
    if (selectedProfession) {
      myWork = myWork.filter(req => req.profession === selectedProfession);
    }
    
    const otherRequestsForChar = myWork.filter(r => r.character === request.character && r.id !== requestId);

    if (otherRequestsForChar.length > 0) {
      // Show option to complete multiple requests
      await showMultiCompleteOptions(interaction, client, channel, request, otherRequestsForChar);
    } else {
      // Just complete this one request
      await completeSingleRequest(interaction, client, channel, requestId);
    }
  } catch (err) {
    log.error('[MANAGE_CRAFTS] Failed to process completion:', err);
    await interaction.reply({
      content: `❌ Failed to process completion: ${err.message}`,
      flags: 1 << 6
    });
  }
}

/**
 * Show options to complete multiple requests for the same character
 */
async function showMultiCompleteOptions(interaction, client, channel, mainRequest, otherRequests) {
  const userId = interaction.user.id;

  let content = `✅ **Complete Requests for ${mainRequest.character}**\n\n`;
  content += `You are completing:\n`;
  content += `• ${mainRequest.request_name} to ${mainRequest.gear_slot}\n\n`;
  content += `This character has ${otherRequests.length} other pending request(s):\n\n`;

  for (let i = 0; i < otherRequests.length; i++) {
    const req = otherRequests[i];
    content += `${i + 1}. ${req.request_name} to ${req.gear_slot}\n`;
  }

  content += `\n**Would you like to complete all requests for ${mainRequest.character}?**`;

  // Create buttons with request IDs in custom IDs
  const requestIds = [mainRequest.id, ...otherRequests.map(r => r.id)].join(',');
  
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`manage_crafts:complete_multi:${requestIds}`)
      .setLabel('Complete All')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`manage_crafts:complete_single:${mainRequest.id}`)
      .setLabel('Complete Only This One')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📋'),
    new ButtonBuilder()
      .setCustomId('manage_crafts:back_to_menu')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('❌')
  ];

  const row = new ActionRowBuilder().addComponents(buttons);

  const msg = await channel.send({ content, components: [row] });
  
  // Track at Level 4 (multi-complete options)
  cleanupService.trackMenuMessage(userId, 4, msg.id);
  
  // Schedule cleanup if in DM mode (SUBMENU = completion selection interface)
  if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleDMCleanup(
      channel,
      client,
      timeout,
      userId,
      'submenu',
      cleanupService.MessageType.SUBMENU
    );
  }
  
  await interaction.deferUpdate();
}

/**
 * Complete a single request
 */
async function completeSingleRequest(interaction, client, channel, requestId) {
  const userId = interaction.user.id;
  // Instead of immediately completing, show a modal to ask how many were completed
  try {
    const request = await db.getRequestById(requestId);
    if (!request) {
      return interaction.reply({ content: `❌ Request #${requestId} not found.`, flags: 1 << 6 });
    }

    const qtyRequested = parseInt(request.quantity_requested || request.quantity || 1, 10) || 1;
    const qtyCompleted = parseInt(request.quantity_completed || 0, 10) || 0;
    const remaining = Math.max(0, qtyRequested - qtyCompleted);

    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
    const modal = new ModalBuilder()
      .setCustomId(`complete_modal_${requestId}`)
      .setTitle('Mark Request Complete');

    const input = new TextInputBuilder()
      .setCustomId('completed_qty')
      .setLabel(`Completed (remaining: ${remaining})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(String(remaining))
      .setRequired(true)
      .setValue(String(remaining));

    modal.addComponents(new ActionRowBuilder().addComponents(input));

    await interaction.showModal(modal);
  } catch (err) {
    log.error('[MANAGE_CRAFTS] Failed to show completion modal:', err);
    await interaction.reply({ content: `❌ Failed to show completion dialog: ${err.message}`, flags: 1 << 6 }).catch(() => {});
  }
}

/**
 * Handles modal submission for completing requests (partial or full).
 */
async function handleCompleteModal(interaction, client) {
  const customId = interaction.customId; // complete_modal_{requestId}
  const requestId = parseInt(customId.replace('complete_modal_', ''), 10);
  const userId = interaction.user.id;

  // Get request data
  const request = await db.getRequestById(requestId);
  if (!request) {
    return interaction.reply({ content: `⚠️ Request #${requestId} not found.`, flags: 1 << 6 });
  }

  const qtyRequested = parseInt(request.quantity_requested || request.quantity || 1, 10) || 1;
  const qtyCompleted = parseInt(request.quantity_completed || 0, 10) || 0;
  const remaining = Math.max(0, qtyRequested - qtyCompleted);

  let entered = 0;
  try {
    const value = interaction.fields.getTextInputValue('completed_qty');
    entered = Math.max(0, Math.min(remaining, parseInt(value || '0', 10) || 0));
  } catch (err) {
    entered = 0;
  }

  if (entered <= 0) {
    return interaction.reply({ content: `❌ You must enter a number between 1 and ${remaining}.`, flags: 1 << 6 });
  }

  try {
    // Call DB partial-completion function
    await db.completeRequestWithQuantity(requestId, userId, entered);

    // Notify requester if configured
    if (config.notificationSettings.notifyOnComplete) {
      const requesterId = request.user_id || request.requester_id;
      if (requesterId) {
        const notifMessage = entered >= remaining
          ? `🎉 Your request **#${requestId}** for **${request.character}** has been completed!`
          : `🔔 Partial completion for request **#${requestId}**: **${entered}** item(s) completed. Remaining: **${remaining - entered}**.`;
        try {
          const requesterUser = await client.users.fetch(requesterId);
          await requesterUser.send(notifMessage);
        } catch (err) {
          log.warn('[MANAGE_CRAFTS] Could not DM requester:', err);
        }
      }
    }

    await interaction.reply({ content: `✅ Marked ${entered} item(s) complete for request #${requestId}.`, flags: 1 << 6 });

    // Refresh details display if applicable
    const channel = await resolveResponseChannel(interaction, client);
    const updatedRequest = await db.getRequestById(requestId);
    await cleanupService.cleanupFromLevel(userId, client, 4);
    // Try to show updated request details if admin view function available
    if (typeof showRequestDetails === 'function') {
      await showRequestDetails(interaction, client, channel, updatedRequest, true).catch(() => {});
    }
  } catch (err) {
    log.error('[MANAGE_CRAFTS] Error completing request via modal:', err);
    return interaction.reply({ content: `❌ Failed to complete request: ${err.message}`, flags: 1 << 6 });
  }
}

/**
 * Complete multiple requests
 */
async function handleCompleteMulti(interaction, client) {
  const [, , requestIdsStr] = interaction.customId.split(':');
  const requestIds = requestIdsStr.split(',').map(id => parseInt(id));
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);

  // Defer immediately to prevent timeout
  await interaction.deferUpdate();

  try {
    let completedRequests = [];
    
    for (const reqId of requestIds) {
      const request = await db.getRequestById(reqId);
      await db.completeRequest(reqId, userId);
      completedRequests.push(request);
    }

    // Group by requester for notifications
    const byRequester = {};
    for (const req of completedRequests) {
      if (!byRequester[req.user_id]) {
        byRequester[req.user_id] = [];
      }
      byRequester[req.user_id].push(req);
    }

    // Send notifications
    if (config.notificationSettings.notifyOnComplete) {
      for (const [requesterId, requests] of Object.entries(byRequester)) {
        const charName = requests[0].character;
        let notifMessage = `🎉 All requests for **${charName}** have been completed!\n\n`;
        for (const req of requests) {
          notifMessage += `• **#${req.id}** ${req.request_name} to ${req.gear_slot}\n`;
        }
        notifMessage += `\nYour items are ready!`;
        await notifyRequester(client, requesterId, notifMessage);
      }
    }

    const charName = completedRequests[0].character;
    const content = `✅ Successfully completed **${requestIds.length}** request(s) for **${charName}**!`;

    // Show confirmation and auto-return to menu
    const confirmMsg = await channel.send({ content });
    cleanupService.trackMenuMessage(userId, 4, confirmMsg.id);
    
    // Small delay to let user read the confirmation
    await new Promise(resolve => setTimeout(resolve, config.confirmationMessageDelay));
    
    // Clear Level 3+ (dropdown/options and confirmation) - keeps header and profession menu
    await cleanupService.cleanupFromLevel(userId, client, 3);
    
    // Re-show crafter menu (interaction already deferred) with preserved profession
    const session = await db.getTempSession(`manage_profession_${userId}`);
    const selectedProfession = session?.selected_profession;
    const member = await getGuildMember(interaction, client);
    const roles = getUserProfessionRoles(member);
    await showCrafterMenu(interaction, client, channel, roles, true, selectedProfession);
  } catch (err) {
    log.error('[MANAGE_CRAFTS] Failed to complete multiple requests:', err);
    // Can't reply now since we already deferred
    await channel.send({
      content: `❌ Failed to complete requests: ${err.message}`
    }).catch(() => {});
  }
}

/**
 * Handle single complete button
 */
async function handleCompleteSingle(interaction, client) {
  const [, , requestIdStr] = interaction.customId.split(':');
  const requestId = parseInt(requestIdStr);
  const channel = await resolveResponseChannel(interaction, client);

  await completeSingleRequest(interaction, client, channel, requestId);
}

/**
 * Release Request - Shows dropdown of claimed requests
 */
async function handleReleaseRequest(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 3+ (keep header and profession menu)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  cleanupService.trackUserChannel(userId, channel.id);

  // Get selected profession from session
  const session = await db.getTempSession(`manage_profession_${userId}`);
  const selectedProfession = session?.selected_profession;
  
  // Get all work and filter by profession if selected
  let myWork = await db.getInProgressRequestsByUser(userId);
  if (selectedProfession) {
    myWork = myWork.filter(req => req.profession === selectedProfession);
  }

  if (myWork.length === 0) {
    const content = '\u274c You have no active requests to release.';
    const msg = await channel.send({ content });
    
    // Track at Level 3 (empty message)
    cleanupService.trackMenuMessage(userId, 3, msg.id);
    
    // Schedule cleanup if user becomes inactive (SUBMENU = empty message)
    if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
      const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
      cleanupService.scheduleDMCleanup(
        channel,
        client,
        timeout,
        userId,
        'submenu',
        cleanupService.MessageType.SUBMENU
      );
    }
    
    return interaction.deferUpdate();
  }

  const options = myWork.map((req, index) => ({
    label: `${index + 1}. ${req.character} | ${req.request_name}`,
    value: `release_${req.id}`,
    description: `${req.profession.charAt(0).toUpperCase() + req.profession.slice(1)} - ${req.gear_slot}`,
    emoji: '🔓'
  }));

  const dropdown = new StringSelectMenuBuilder()
    .setCustomId('manage_crafts:release_dropdown')
    .setPlaceholder('Select requests to release (can select multiple)')
    .setMinValues(1)
    .setMaxValues(Math.min(options.length, 25))
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(dropdown);

  const msg = await channel.send({
    content: `🔓 **Release Requests**\n\n**How to use:**\n• Click the dropdown menu below\n• Select one or more requests (click multiple items to select)\n• Press **Enter** or click outside to submit your selection\n\nYou can release multiple requests at once:`,
    components: [row]
  });

  // Track at Level 3 (submenu dropdown)
  cleanupService.trackMenuMessage(userId, 3, msg.id);

  // Schedule cleanup if user becomes inactive (SUBMENU = dropdown selection)
  if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleDMCleanup(
      channel,
      client,
      timeout,
      userId,
      'submenu',
      cleanupService.MessageType.SUBMENU
    );
  }

  await interaction.deferUpdate();
}

/**
 * Handle release dropdown selection
 */
async function handleReleaseDropdown(interaction, client) {
  const selectedValues = interaction.values; // Array of selected values
  const requestIds = selectedValues.map(val => parseInt(val.replace('release_', '')));
  const userId = interaction.user.id;
  const userName = interaction.user.username;
  const channel = await resolveResponseChannel(interaction, client);

  // Defer immediately to prevent timeout
  await interaction.deferUpdate();

  try {
    let successCount = 0;
    let failedReleases = [];
    const releasedRequests = [];

    // Release each selected request
    for (const requestId of requestIds) {
      try {
        // Get request details for notification
        const request = await db.getRequestById(requestId);
        await db.releaseRequest(requestId, userId);
        releasedRequests.push(request);

        // Send notification to requester
        if (config.notificationSettings.notifyOnRelease) {
          const notifMessage = `⚠️ Your request **#${requestId}** for **${request.character}** has been released back to the open queue.\n\n` +
            `**Profession:** ${request.profession}\n` +
            `**Request:** ${request.request_name} to ${request.gear_slot}\n\n` +
            `It is now available for other crafters to claim.`;
          await notifyRequester(client, request.user_id, notifMessage);
        }
        
        successCount++;
      } catch (err) {
        log.error(`[MANAGE_CRAFTS] Failed to release request ${requestId}:`, err);
        failedReleases.push(requestId);
      }
    }

    // Build confirmation message
    let content = `✅ Successfully released **${successCount}** request(s)!\n\n`;
    
    if (releasedRequests.length > 0) {
      content += 'Released:\n';
      for (const req of releasedRequests) {
        content += `• **#${req.id}** ${req.character} - ${req.request_name}\n`;
      }
    }
    
    if (failedReleases.length > 0) {
      content += `\n❌ Failed to release: ${failedReleases.join(', ')}`;
    }

    // Show confirmation and auto-return to menu
    const confirmMsg = await channel.send({ content });
    cleanupService.trackMenuMessage(userId, 4, confirmMsg.id);
    
    // Small delay to let user read the confirmation
    await new Promise(resolve => setTimeout(resolve, config.confirmationMessageDelay));
    
    // Clear Level 3+ (dropdown and confirmation) - keeps header and profession menu
    await cleanupService.cleanupFromLevel(userId, client, 3);
    
    // Re-show crafter menu (interaction already deferred) with preserved profession
    const session = await db.getTempSession(`manage_profession_${userId}`);
    const selectedProfession = session?.selected_profession;
    const member = await getGuildMember(interaction, client);
    const roles = getUserProfessionRoles(member);
    await showCrafterMenu(interaction, client, channel, roles, true, selectedProfession);
  } catch (err) {
    log.error('[MANAGE_CRAFTS] Failed to process releases:', err);
    // Can't reply now since we already deferred
    await channel.send({
      content: `❌ Failed to release requests: ${err.message}`
    }).catch(() => {});
  }
}

/**
 * Material Lists - Show options for generating material lists
 */
async function handleMaterialLists(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 3+ (keep header and profession menu)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  cleanupService.trackUserChannel(userId, channel.id);

  const buttons = [
    new ButtonBuilder()
      .setCustomId('manage_crafts:materials_master')
      .setLabel('Master List')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📦'),
    new ButtonBuilder()
      .setCustomId('manage_crafts:materials_per_char')
      .setLabel('Per Character')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('\ud83d\udc64')
  ];

  const row = new ActionRowBuilder().addComponents(buttons);

  const msg = await channel.send({
    content: `\ud83d\udce6 **Material Lists**\n\nChoose how you'd like to view your materials:\n\n` +
             `\ud83d\udce6 **Master List** - Combined list of all materials across all your requests\n` +
             `\ud83d\udc64 **Per Character** - Materials organized by character`,
    components: [row]
  });

  // Track at Level 3 (submenu menu)
  cleanupService.trackMenuMessage(userId, 3, msg.id);

  // Schedule cleanup if user becomes inactive (SUBMENU = material list menu)
  if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleDMCleanup(
      channel,
      client,
      timeout,
      userId,
      'submenu',
      cleanupService.MessageType.SUBMENU
    );
  }

  await interaction.deferUpdate();
}

/**
 * Generate master material list
 */
async function handleMaterialsMaster(interaction, client) {
  const userId = interaction.user.id;
  
  // Defer interaction immediately to prevent timeout
  await interaction.deferUpdate();
  
  const channel = await resolveResponseChannel(interaction, client);
  
  log.debug(`[MATERIALS] Master list requested by user ${userId}, cleaning Level 4+`);
  // Clean Level 4+ (keep header, profession menu, and materials menu)
  await cleanupService.cleanupFromLevel(userId, client, 4);
  cleanupService.trackUserChannel(userId, channel.id);

  // Get selected profession from session
  const session = await db.getTempSession(`manage_profession_${userId}`);
  const selectedProfession = session?.selected_profession;
  
  // Get all work and filter by profession if selected
  let myWork = await db.getInProgressRequestsByUser(userId);
  if (selectedProfession) {
    myWork = myWork.filter(req => req.profession === selectedProfession);
  }

  if (myWork.length === 0) {
    const content = '❌ You have no active requests.';
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('manage_crafts:back_to_menu')
        .setLabel('Back to Menu')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⬅️')
    );
    
    const msg = await channel.send({ content, components: [backButton] });
    return;
  }

  // Aggregate all materials
  const materialTotals = {};
  for (const req of myWork) {
    // Only include requests where the guild provides materials
    // (requests where `provides_materials` is falsy indicate guild craft)
    if (req.provides_materials) continue;
    if (req.materials_json) {
      try {
        log.debug(`[MATERIALS] Processing request ${req.id}, raw materials_json: ${req.materials_json}`);
        const materials = JSON.parse(req.materials_json);
        log.debug(`[MATERIALS] Parsed materials for request ${req.id}:`, JSON.stringify(materials));
        
        // Determine quantity multiplier for this request
        const qtyMultiplier = parseInt(req.quantity_requested || req.quantity || 1, 10) || 1;

        // Handle array format ["Material x10", "Other x5"]
        if (Array.isArray(materials)) {
          log.warn(`[MATERIALS] Request ${req.id} has array format materials, converting...`);
          for (const materialStr of materials) {
            const match = materialStr.match(/^(.+?)\\s+x(\\d+)$/);
            if (match) {
              const [, materialName, quantity] = match;
              const parsedQty = parseInt(quantity, 10);
              if (!isNaN(parsedQty) && parsedQty > 0) {
                const added = parsedQty * qtyMultiplier;
                materialTotals[materialName.trim()] = (materialTotals[materialName.trim()] || 0) + added;
                log.debug(`[MATERIALS] Added ${added} ${materialName.trim()}, total now: ${materialTotals[materialName.trim()]}`);
              }
            }
          }
        }
        // Handle object format {"Material": quantity}
        else if (typeof materials === 'object' && materials !== null) {
          for (const [materialName, quantity] of Object.entries(materials)) {
            // Skip entries where key looks like an index
            if (materialName.match(/^\\d+$/)) continue;
            
            // Parse quantity to ensure it's a number
            const parsedQty = parseInt(quantity, 10);
            if (!isNaN(parsedQty) && parsedQty > 0) {
              const added = parsedQty * qtyMultiplier;
              materialTotals[materialName] = (materialTotals[materialName] || 0) + added;
              log.debug(`[MATERIALS] Added ${added} ${materialName}, total now: ${materialTotals[materialName]}`);
            }
          }
        }
      } catch (err) {
        log.warn(`[MATERIALS] Failed to parse materials for request ${req.id}:`, err);
      }
    }
  }

  let content = `📦 **Master Material List**\n\n`;
  content += `Total materials needed for **${myWork.length}** request(s):\n\n`;

  if (Object.keys(materialTotals).length === 0) {
    content += '*No materials required.*\n';
  } else {
    // Sort materials alphabetically for consistent display
    const sortedMaterials = Object.entries(materialTotals).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [materialName, totalQty] of sortedMaterials) {
      content += `• **${materialName}** x${totalQty}\n`;
    }
  }

  const msg = await channel.send({ content });
  
  // Track at Level 4 (material data display)
  cleanupService.trackMenuMessage(userId, 4, msg.id);
  log.debug(`[MATERIALS] Master list message ${msg.id} tracked at Level 4 for user ${userId}`);
  
  // Schedule cleanup if user becomes inactive (SUBMENU = material list display)
  if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleDMCleanup(
      channel,
      client,
      timeout,
      userId,
      'submenu',
      cleanupService.MessageType.SUBMENU
    );
  }
}

/**
 * Generate per-character material list
 */
async function handleMaterialsPerChar(interaction, client) {
  const userId = interaction.user.id;
  
  // Defer interaction immediately to prevent timeout
  await interaction.deferUpdate();
  
  const channel = await resolveResponseChannel(interaction, client);
  
  log.debug(`[MATERIALS] Per-character list requested by user ${userId}, cleaning Level 4+`);
  // Clean Level 4+ (keep header, profession menu, and materials menu)
  await cleanupService.cleanupFromLevel(userId, client, 4);
  cleanupService.trackUserChannel(userId, channel.id);

  // Get selected profession from session
  const session = await db.getTempSession(`manage_profession_${userId}`);
  const selectedProfession = session?.selected_profession;
  
  // Get all work and filter by profession if selected
  let myWork = await db.getInProgressRequestsByUser(userId);
  if (selectedProfession) {
    myWork = myWork.filter(req => req.profession === selectedProfession);
  }

  if (myWork.length === 0) {
    const content = '❌ You have no active requests.';
    const backButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('manage_crafts:back_to_menu')
        .setLabel('Back to Menu')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⬅️')
    );
    
    const msg = await channel.send({ content, components: [backButton] });
    return;
  }

  // Group by character
  const byCharacter = {};
  for (const req of myWork) {
    if (!byCharacter[req.character]) {
      byCharacter[req.character] = [];
    }
    byCharacter[req.character].push(req);
  }

  let content = `📦 **Materials Per Character**\n\n`;

  for (const [charName, requests] of Object.entries(byCharacter)) {
    content += `**${charName}** (${requests.length} request(s)):\n`;
    
    const charMaterials = {};
    for (const req of requests) {
      // Only include materials for guild-provided requests (provides_materials falsy)
      if (req.provides_materials) continue;
      if (req.materials_json) {
        try {
          const materials = JSON.parse(req.materials_json);
          const qtyMultiplier = parseInt(req.quantity_requested || req.quantity || 1, 10) || 1;
          for (const [mat, qty] of Object.entries(materials)) {
            const added = (parseInt(qty, 10) || 0) * qtyMultiplier;
            charMaterials[mat] = (charMaterials[mat] || 0) + added;
          }
        } catch (err) {
          log.warn(`[MATERIALS] Failed to parse materials for request ${req.id}:`, err);
        }
      }
    }

    if (Object.keys(charMaterials).length === 0) {
      content += '  *No materials required*\n';
    } else {
      // Sort materials alphabetically for consistent display
      const sortedMaterials = Object.entries(charMaterials).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [mat, qty] of sortedMaterials) {
        content += `  • **${mat}** x${qty}\n`;
      }
    }
    content += '\n';
  }

  const msg = await channel.send({ content });
  
  // Track at Level 4 (material data display)
  cleanupService.trackMenuMessage(userId, 4, msg.id);
  log.debug(`[MATERIALS] Per-character list message ${msg.id} tracked at Level 4 for user ${userId}`);
  
  // Schedule cleanup if user becomes inactive (SUBMENU = material list display)
  if (config.requestMode === 'dm' && channel.type === ChannelType.DM) {
    const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.SUBMENU);
    cleanupService.scheduleDMCleanup(
      channel,
      client,
      timeout,
      userId,
      'submenu',
      cleanupService.MessageType.SUBMENU
    );
  }
}

/**
 * Back to menu handler - preserves profession context
 */
async function handleBackToMenu(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  // NOTE: resolveResponseChannel already calls ensureDMMenu in DM mode
  
  // Retrieve selected profession from session
  const session = await db.getTempSession(`manage_profession_${userId}`);
  const selectedProfession = session?.selected_profession;
  
  // Track then clean ALL other Level 1 flows (preserve only primary menu)
  cleanupService.trackUserChannel(userId, channel.id);
  await cleanupService.cleanupAllFlowMessages(userId, client);
  cleanupService.clearMenuHierarchy(userId);
  
  const member = await getGuildMember(interaction, client);
  const admin = isAdmin(member);
  const roles = getUserProfessionRoles(member);
  
  // Show appropriate menu with preserved profession context
  if (admin) {
    await showAdminMenu(interaction, client, channel);
  } else {
    // Pass the selected profession to showCrafterMenu so it doesn't show selector again
    await showCrafterMenu(interaction, client, channel, roles, false, selectedProfession);
  }
}

/**
 * Handle profession selection from selector
 */
async function handleSelectProfession(interaction, client) {
  const profession = interaction.customId.split(':')[2];
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 2+ (profession selector and below) - keeps manage requests header if present
  await cleanupService.cleanupFromLevel(userId, client, 2);
  cleanupService.trackUserChannel(userId, channel.id);
  
  const member = await getGuildMember(interaction, client);
  const professionRoles = getUserProfessionRoles(member);
  
  // Show crafter menu for selected profession
  await showCrafterMenu(interaction, client, channel, professionRoles, false, profession);
}

/**
 * Handle Change Profession button
 */
async function handleChangeProfession(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 2+ (profession menu and below) - keeps manage requests header
  await cleanupService.cleanupFromLevel(userId, client, 2);
  cleanupService.trackUserChannel(userId, channel.id);
  
  const member = await getGuildMember(interaction, client);
  const professionRoles = getUserProfessionRoles(member);
  
  // Acknowledge the interaction FIRST (button click must be handled)
  const confirmation = getNavigationMessage(interaction, channel);
  if (confirmation) {
    await interaction.reply({ content: confirmation, flags: 1 << 6 });
  } else {
    await interaction.deferUpdate();
  }
  
  // Show profession selector (interaction already handled)
  await showProfessionSelector(interaction, client, channel, professionRoles, true);
}

/**
 * Switch from admin menu to crafter menu
 */
async function handleSwitchToCrafter(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 2+ (admin menu and below)
  await cleanupService.cleanupFromLevel(userId, client, 2);
  cleanupService.trackUserChannel(userId, channel.id);
  
  const member = await getGuildMember(interaction, client);
  const professionRoles = getUserProfessionRoles(member);
  
  // Acknowledge the interaction
  const confirmation = getNavigationMessage(interaction, channel);
  if (confirmation) {
    await interaction.reply({ content: confirmation, flags: 1 << 6 });
  } else {
    await interaction.deferUpdate();
  }
  
  // Show crafter menu (interaction already handled, no profession pre-selected)
  await showCrafterMenu(interaction, client, channel, professionRoles, true, null);
}

/**
 * Switch from crafter menu back to admin menu
 */
async function handleSwitchToAdmin(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 2+ (header and profession menu and below)
  await cleanupService.cleanupFromLevel(userId, client, 2);
  cleanupService.trackUserChannel(userId, channel.id);
  
  // Acknowledge the interaction
  const confirmation = getNavigationMessage(interaction, channel);
  if (confirmation) {
    await interaction.reply({ content: confirmation, flags: 1 << 6 });
  } else {
    await interaction.deferUpdate();
  }
  
  // Show admin menu (interaction already handled)
  await showAdminMenu(interaction, client, channel, true);
}

module.exports = {
  handleManageRequestsMain,
  handleViewMyWork,
  handleClaimRequest,
  handleClaimDropdown,
  handleMarkComplete,
  handleCompleteDropdown,
  handleCompleteMulti,
  handleCompleteSingle,
  handleCompleteModal,
  handleReleaseRequest,
  handleReleaseDropdown,
  handleMaterialLists,
  handleMaterialsMaster,
  handleMaterialsPerChar,
  handleBackToMenu,
  handleSelectProfession,
  handleChangeProfession,
  handleSwitchToCrafter,
  handleSwitchToAdmin
};
