// interactions/shared/statusFlow.js
const db = require('../../utils/database');
const config = require('../../config/config.js');
const { resolveResponseChannel } = require('../../utils/requestChannel');
const { getNavigationMessage } = require('../../utils/navigationHelper');
const { getRequestLabel, getRequestSubtext } = require('../../utils/requestFormatter');
const cleanupService = require('../../utils/cleanupService');
const { ensureDMMenu } = require('../../utils/dmMenu');
const log = require('../../utils/logWriter');
const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');

/**
 * Initial status command - shows profession selection menu
 * @param {boolean} isButton - True if called from a button press (not a slash command)
 */
async function handleStatusCommand(interaction, client, isButton = false) {
  const userId = interaction.user.id;
  
  // ** DEFER IMMEDIATELY if button to prevent timeout **
  if (isButton && !interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate();
  }
  
  const chars = await db.getCharactersByUser(userId);

  if (!chars.length) {
    const replyMethod = isButton ? 'followUp' : 'reply';
    return interaction[replyMethod]({
      content: '❌ You have no registered characters. Use `/register` in the server (not in DMs).',
      flags: 1 << 6
    });
  }

  // ** CLEANUP: Clear ALL other Level 1 flows before starting status flow **
  const channel = await resolveResponseChannel(interaction, client);
  // NOTE: resolveResponseChannel already calls ensureDMMenu in DM mode
  
  cleanupService.trackUserChannel(userId, channel.id);
  await cleanupService.cleanupAllFlowMessages(userId, client);
  cleanupService.clearMenuHierarchy(userId);

  // Show profession selection menu (interaction already deferred if button)
  await showRequestsMenu(interaction, client, userId, isButton);
}

/**
 * Displays the main requests menu with profession selection
 * @param {boolean} alreadyDeferred - True if interaction already deferred
 */
async function showRequestsMenu(interaction, client, userId, alreadyDeferred = false) {
  // Always send to resolved channel (respects DM/channel mode)
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 2+ when navigating back (remove old menu and submenus, create fresh one)
  if (alreadyDeferred) {
    await cleanupService.cleanupFromLevel(userId, client, 2);
  }
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📋 My Requests')
    .setDescription('Recent requests from each profession (showing up to 3 per profession):\n\n\u200B');
  
  // Fetch and display preview of recent requests per profession (3-5 most recent)
  let hasAnyRequests = false;
  for (const prof of config.enabledProfessions) {
    const requests = await db.getRequestsByUserId(
      userId,
      ['open', 'claimed', 'in_progress'],
      3, // Show up to 3 per profession
      prof
    );
    
    if (requests.length > 0) {
      hasAnyRequests = true;
      let fieldText = '';
      for (const req of requests) {
        const emoji = req.status === 'open' ? '⏳' : req.status === 'claimed' ? '👤' : '⚙️';
        const label = getRequestLabel(req);
        fieldText += `${emoji} ${req.character}: ${label}\n`;
      }
      
      // Add "X more..." if there are additional requests
      const totalCount = await db.getRequestsByUserId(userId, ['open', 'claimed', 'in_progress'], 999, prof);
      if (totalCount.length > 3) {
        fieldText += `_...and ${totalCount.length - 3} more_\n`;
      }
      
      const professionName = prof.charAt(0).toUpperCase() + prof.slice(1);
      embed.addFields({ 
        name: `🔧 ${professionName} (${totalCount.length} pending)`, 
        value: fieldText.trim() + '\n\u200B', 
        inline: false 
      });
    }
  }
  
  if (!hasAnyRequests) {
    embed.setDescription('✅ You have no pending requests!\n\n\u200B');
  }
  
  embed.setFooter({ text: 'Click a button below to view more details or take action.\u200B' });

  // Create buttons for each enabled profession + "All" + "Completed"
  const rows = [];
  const profButtons = [];

  // All Requests button (summary)
  profButtons.push(
    new ButtonBuilder()
      .setCustomId('status_view_all')
      .setLabel('📊 All Requests')
      .setStyle(ButtonStyle.Primary)
  );

  // Individual profession buttons
  for (const prof of config.enabledProfessions) {
    profButtons.push(
      new ButtonBuilder()
        .setCustomId(`status_view_prof_${prof.toLowerCase()}`)
        .setLabel(prof.charAt(0).toUpperCase() + prof.slice(1))
        .setStyle(ButtonStyle.Secondary)
    );
  }

  // Split profession buttons into rows (max 5 per row)
  for (let i = 0; i < profButtons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(profButtons.slice(i, i + 5)));
  }

  // View Completed button on separate row
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('status_view_completed')
      .setLabel('📜 All Completed')
      .setStyle(ButtonStyle.Success)
  ));

  // Send menu to resolved channel
  const msg = await channel.send({
    embeds: [embed],
    components: rows
  });
  
  // Track at Level 2 (main status anchor menu)
  cleanupService.trackMenuMessage(userId, 2, msg.id);
  
  // Schedule cleanup if in DM mode (SUBMENU = status menu)
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

  // Reply with navigation message (only if not already deferred)
  if (!alreadyDeferred) {
    const confirmation = getNavigationMessage(interaction, channel);
    if (confirmation) {
      await interaction.reply({
        content: confirmation,
        flags: 1 << 6
      });
    } else {
      // In DM mode with no navigation message, just acknowledge silently
      await interaction.deferUpdate();
    }
  }
}

/**
 * Handles status button interactions (profession selection, view all, view completed)
 */
async function handleStatusButton(interaction, client) {
  const customId = interaction.customId;
  const userId = interaction.user.id;

  try {
    await interaction.deferUpdate();

    const chars = await db.getCharactersByUser(userId);
    if (!chars.length) {
      return interaction.followUp({
        content: '❌ You have no registered characters. Use `/register` in the server (not in DMs).',
        flags: 1 << 6
      });
    }

    if (customId === 'status_view_all') {
      // Show summary of all professions (max 5 per profession)
      await showAllProfessionsSummary(interaction, client);
    } else if (customId === 'status_view_completed') {
      // Show all completed/denied requests (page 0, all professions)
      await showCompletedRequests(interaction, 0, null, client);
    } else if (customId.startsWith('status_view_completed_prof_')) {
      // Show completed requests for specific profession (page 0)
      const profession = customId.replace('status_view_completed_prof_', '');
      await showCompletedRequests(interaction, 0, profession, client);
    } else if (customId.startsWith('status_completed_page_')) {
      // Handle pagination for completed requests
      const remainder = customId.replace('status_completed_page_', '');
      
      // Check if there's a profession suffix
      if (remainder.includes('_prof_')) {
        const parts = remainder.split('_prof_');
        const page = parseInt(parts[0]);
        const profession = parts[1];
        await showCompletedRequests(interaction, page, profession, client);
      } else {
        // All professions
        const page = parseInt(remainder);
        await showCompletedRequests(interaction, page, null, client);
      }
    } else if (customId.startsWith('status_view_prof_')) {
      // Show specific profession
      const profession = customId.replace('status_view_prof_', '');
      await showProfessionRequests(interaction, profession, client);
    } else if (customId === 'status_cancel_request') {
      // Show cancel request menu
      await showCancelRequestMenu(interaction, client);
    } else if (customId.startsWith('status_back_')) {
      // Navigate back
      await showRequestsMenu(interaction, client, userId, true);
    }
  } catch (err) {
    console.error('[STATUS BUTTON] Error:', err);
    await interaction.followUp({
      content: '❌ An error occurred while processing your request.',
      flags: 1 << 6
    }).catch(() => {});
  }
}

/**
 * Shows summary of all professions (max 5 requests per profession)
 */
async function showAllProfessionsSummary(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 2+ (keep main status menu)
  await cleanupService.cleanupFromLevel(userId, client, 2);
  
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('📊 All Professions - Summary')
    .setDescription('Showing up to 5 pending requests per profession:\n\u200B');

  let hasAnyRequests = false;

  for (const prof of config.enabledProfessions) {
    const requests = await db.getRequestsByUserId(
      userId,
      ['open', 'claimed', 'in_progress'],
      5,
      prof
    );

    if (requests.length > 0) {
      hasAnyRequests = true;
      let fieldText = '';
      for (const req of requests) {
        const emoji = req.status === 'open' ? '⏳' : req.status === 'claimed' ? '👤' : '⚙️';
        const label = getRequestLabel(req);
        fieldText += `${emoji} [${req.status}] ${req.character}: ${label} to ${req.gear_slot}\n`;
      }
      
      // Truncate if too long (very unlikely with only 5 items, but safety check)
      if (fieldText.length > 1000) {
        fieldText = fieldText.substring(0, 997) + '...';
      }
      
      embed.addFields({ name: `🔧 ${prof.toUpperCase()}`, value: fieldText.trim() + '\n\u200B', inline: false });
    }
  }

  if (!hasAnyRequests) {
    embed.setDescription('✅ You have no pending requests across any professions!\n\n\u200B');
  }

  embed.setFooter({ text: '\u200B' }); // Add spacing above buttons

  // Action buttons
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('status_cancel_request')
      .setLabel('❌ Cancel a Request')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasAnyRequests),
    new ButtonBuilder()
      .setCustomId('status_back_menu')
      .setLabel('🔙 Back to Menu')
      .setStyle(ButtonStyle.Secondary)
  );

  const msg = await channel.send({
    embeds: [embed],
    components: [row]
  });
  
  // Track at Level 3 (submenu display)
  cleanupService.trackMenuMessage(userId, 3, msg.id);
  
  // Schedule cleanup if in DM mode (SUBMENU timeout)
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
 * Shows requests for a specific profession
 */
async function showProfessionRequests(interaction, profession, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 3+ (keep main status menu at Level 2)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  
  const requests = await db.getRequestsByUserId(
    userId,
    ['open', 'claimed', 'in_progress'],
    config.requestHistoryLimit || 25,
    profession
  );

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`🔧 ${profession.charAt(0).toUpperCase() + profession.slice(1)} Requests`)
    .setDescription(requests.length > 0 ? 'Your pending requests:\n\u200B' : '✅ No pending requests for this profession!\n\n\u200B');

  if (requests.length > 0) {
    // Build request lines
    const lines = [];
    for (const req of requests) {
      const emoji = req.status === 'open' ? '⏳' : req.status === 'claimed' ? '👤' : '⚙️';
      const label = getRequestLabel(req);
      lines.push(`${emoji} [${req.status}] ${req.character}: ${label} to ${req.gear_slot}`);
    }
    
    // Split into multiple fields if needed (Discord limit: 1024 chars per field)
    const fieldLimit = 1000; // Leave buffer for safety
    let currentField = '';
    let fieldIndex = 1;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const testField = currentField + line + '\n';
      
      if (testField.length > fieldLimit) {
        // Current field would exceed limit, save it and start new one
        if (currentField) {
          const fieldName = fieldIndex === 1 ? 'Pending Requests' : `Pending Requests (continued ${fieldIndex})`;
          embed.addFields({ name: fieldName, value: currentField.trim() + '\n\u200B', inline: false });
          fieldIndex++;
        }
        currentField = line + '\n';
      } else {
        currentField = testField;
      }
    }
    
    // Add remaining field
    if (currentField) {
      const fieldName = fieldIndex === 1 ? 'Pending Requests' : `Pending Requests (continued ${fieldIndex})`;
      embed.addFields({ name: fieldName, value: currentField.trim() + '\n\u200B', inline: false });
    }
  }

  embed.setFooter({ text: '\u200B' }); // Add spacing above buttons

  // Action buttons - Row 1
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('status_cancel_request')
      .setLabel('❌ Cancel a Request')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(requests.length === 0),
    new ButtonBuilder()
      .setCustomId('status_back_menu')
      .setLabel('🔙 Back to Menu')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 2 - View Completed
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`status_view_completed_prof_${profession}`)
      .setLabel('📜 View Completed')
      .setStyle(ButtonStyle.Success)
  );

  const msg = await channel.send({
    embeds: [embed],
    components: [row1, row2]
  });
  
  // Track at Level 3 (submenu display)
  cleanupService.trackMenuMessage(userId, 3, msg.id);
  
  // Schedule cleanup if in DM mode (SUBMENU timeout)
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
 * Shows completed/denied requests with pagination
 * @param {string|null} profession - Optional profession filter (null shows all professions)
 */
async function showCompletedRequests(interaction, page = 0, profession = null, client) {
  const itemsPerPage = 10;
  
  // Use user_id to get all requests including those from deleted characters
  const userId = interaction.user.id;
  const allRequests = await db.getRequestsByUserId(
    userId,
    ['complete', 'denied'],
    999, // Get all completed/denied requests
    profession // Filter by profession if provided
  );

  const totalPages = Math.ceil(allRequests.length / itemsPerPage);
  const startIndex = page * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const requests = allRequests.slice(startIndex, endIndex);

  const title = profession 
    ? `📜 Completed ${profession.charAt(0).toUpperCase() + profession.slice(1)} Requests`
    : '📜 Completed & Cancelled Requests';

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(title)
    .setDescription(
      requests.length > 0 
        ? `Showing ${startIndex + 1}-${Math.min(endIndex, allRequests.length)} of ${allRequests.length} requests:\n\u200B` 
        : 'No completed or cancelled requests found.\n\n\u200B'
    );

  if (requests.length > 0) {
    // Build request lines
    const lines = [];
    for (const req of requests) {
      const emoji = req.status === 'complete' ? '\u2705' : '\u274c';
      const statusLabel = req.status === 'complete' ? 'complete' : 'cancelled';
      const label = getRequestLabel(req);
      let line = `${emoji} [${statusLabel}] ${req.character} (${req.profession}): ${label} to ${req.gear_slot}`;
      if (req.status === 'denied' && req.deny_reason) {
        line += ` \u2014 Reason: ${req.deny_reason}`;
      }
      lines.push(line);
    }
    
    // Split into multiple fields if needed (Discord limit: 1024 chars per field)
    const fieldLimit = 1000; // Leave buffer for safety
    let currentField = '';
    let fieldIndex = 1;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const testField = currentField + line + '\n';
      
      if (testField.length > fieldLimit) {
        // Current field would exceed limit, save it and start new one
        if (currentField) {
          const fieldName = fieldIndex === 1 ? 'Requests' : `Requests (continued ${fieldIndex})`;
          embed.addFields({ name: fieldName, value: currentField.trim() + '\n\u200B', inline: false });
          fieldIndex++;
        }
        currentField = line + '\n';
      } else {
        currentField = testField;
      }
    }
    
    // Add remaining field
    if (currentField) {
      const fieldName = fieldIndex === 1 ? 'Requests' : `Requests (continued ${fieldIndex})`;
      embed.addFields({ name: fieldName, value: currentField.trim() + '\n\u200B', inline: false });
    }
  }

  if (totalPages > 1) {
    embed.setFooter({ text: `Page ${page + 1} of ${totalPages}` });
  } else {
    embed.setFooter({ text: '\u200B' });
  }

  // Navigation buttons
  const components = [];
  const buttons = [];

  // Add pagination buttons only if there are multiple pages
  if (totalPages > 1) {
    const profSuffix = profession ? `_prof_${profession}` : '';
    
    if (page > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`status_completed_page_${page - 1}${profSuffix}`)
          .setLabel('◀️ Previous')
          .setStyle(ButtonStyle.Primary)
      );
    }
    
    if (page < totalPages - 1) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`status_completed_page_${page + 1}${profSuffix}`)
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Primary)
      );
    }
  }

  // Always add back button
  buttons.push(
    new ButtonBuilder()
      .setCustomId('status_back_menu')
      .setLabel('🔙 Back to Menu')
      .setStyle(ButtonStyle.Secondary)
  );

  components.push(new ActionRowBuilder().addComponents(buttons));

  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 3+ (keep main status menu at Level 2)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  
  const msg = await channel.send({
    embeds: [embed],
    components
  });
  
  // Track at Level 3 (submenu display)
  cleanupService.trackMenuMessage(userId, 3, msg.id);
  
  // Schedule cleanup if in DM mode (SUBMENU timeout)
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
 * Shows cancel request dropdown menu
 */
async function showCancelRequestMenu(interaction, client) {
  const userId = interaction.user.id;
  const requests = await db.getRequestsByUserId(
    userId,
    ['open', 'claimed', 'in_progress'],
    25 // Max 25 for dropdown (Discord limit)
  );

  if (requests.length === 0) {
    return interaction.followUp({
      content: '❌ You have no pending requests to cancel.',
      flags: 1 << 6
    });
  }

  // Sort requests by profession first, then by created_at (oldest first)
  requests.sort((a, b) => {
    // First sort by profession
    if (a.profession < b.profession) return -1;
    if (a.profession > b.profession) return 1;
    // Then by creation date (oldest first)
    return new Date(a.created_at) - new Date(b.created_at);
  });

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('❌ Cancel Requests')
    .setDescription('Select one or more requests to cancel from the dropdown below:\n\n💡 **Tip:** You can select multiple requests to cancel them all at once!\n\n\u200B');

  const options = requests.map(req => {
    const label = getRequestLabel(req);
    const professionName = req.profession.charAt(0).toUpperCase() + req.profession.slice(1);
    return {
      label: `[${professionName}] ${req.character}: ${label}`.slice(0, 100),
      description: `${req.gear_slot} - Status: ${req.status}`.slice(0, 100),
      value: `cancel_req_${req.id}`
    };
  }).slice(0, 25); // Discord limit

  embed.setFooter({ text: 'Requests are grouped by profession and sorted by submission date.\u200B' });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('status_cancel_confirm')
    .setPlaceholder('Select requests to cancel (multi-select enabled)...')
    .setMinValues(1)
    .setMaxValues(Math.min(requests.length, 25)) // Allow selecting all available requests
    .addOptions(options);

  const row1 = new ActionRowBuilder().addComponents(selectMenu);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('status_back_menu')
      .setLabel('🔙 Back')
      .setStyle(ButtonStyle.Secondary)
  );

  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 3+ (keep main status menu at Level 2)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  
  const msg = await channel.send({
    embeds: [embed],
    components: [row1, row2]
  });
  
  // Track at Level 3 (submenu display - or Level 4 if called from profession view)
  cleanupService.trackMenuMessage(userId, 3, msg.id);
  
  // Schedule cleanup if in DM mode (SUBMENU timeout)
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
 * Handles cancel request confirmation (from dropdown - supports multi-select)
 */
async function handleStatusDropdown(interaction, client) {
  const customId = interaction.customId;
  const values = interaction.values;

  try {
    if (customId === 'status_cancel_confirm') {
      const requestIds = values.map(v => parseInt(v.replace('cancel_req_', '')));
      
      const timestamp = new Date().toISOString();
      const cancelledRequests = [];
      const notifiedCrafters = new Set(); // Track unique crafters to notify
      
      // Process each selected request
      for (const requestId of requestIds) {
        // Get request details before cancelling
        const request = await db.getRequestById(requestId);
        
        if (!request) {
          log.warn(`[STATUS] Request ${requestId} not found for cancellation`);
          continue;
        }
        
        // Cancel the request (set status to 'denied' with reason)
        await db.run(
          `UPDATE requests 
           SET status = 'denied',
               deny_reason = ?,
               updated_at = ?
           WHERE id = ?`,
          ['Cancelled by requester', timestamp, requestId]
        );
        
        // Add audit log entry
        await db.appendAuditLog(requestId, 'Cancelled by requester', interaction.user.id);
        
        cancelledRequests.push(request);
        
        // Track crafter for notification
        if (request.claimed_by) {
          notifiedCrafters.add(JSON.stringify({
            id: request.claimed_by,
            name: request.claimed_by_name
          }));
        }
      }
      
      // Notify crafters (one message per crafter with all their cancelled requests)
      for (const crafterJson of notifiedCrafters) {
        const crafter = JSON.parse(crafterJson);
        const crafterRequests = cancelledRequests.filter(r => r.claimed_by === crafter.id);
        
        try {
          const crafterUser = await client.users.fetch(crafter.id);
          let notificationMessage = `🚫 **${crafterRequests.length} request(s) you claimed have been cancelled by the requester:**\n\n`;
          
          for (const req of crafterRequests) {
            const professionName = req.profession.charAt(0).toUpperCase() + req.profession.slice(1);
            notificationMessage += `• **[${professionName}]** ${req.request_name} for ${req.character}\n`;
          }
          
          await crafterUser.send(notificationMessage).catch(err => {
            log.warn(`[STATUS] Could not notify crafter ${crafter.id}: ${err.message}`);
          });
        } catch (err) {
          log.warn(`[STATUS] Could not fetch crafter user ${crafter.id}: ${err.message}`);
        }
      }
      
      // Build confirmation message
      let confirmMessage = `✅ **${cancelledRequests.length} request(s) cancelled successfully.**\n\n`;
      
      // Group by profession for summary
      const byProfession = {};
      for (const req of cancelledRequests) {
        if (!byProfession[req.profession]) byProfession[req.profession] = [];
        byProfession[req.profession].push(req);
      }
      
      for (const [profession, requests] of Object.entries(byProfession)) {
        const professionName = profession.charAt(0).toUpperCase() + profession.slice(1);
        confirmMessage += `**${professionName}:** ${requests.length} request(s)\n`;
      }
      
      if (notifiedCrafters.size > 0) {
        confirmMessage += `\n📨 ${notifiedCrafters.size} crafter(s) have been notified.`;
      }
      
      const userId = interaction.user.id;
      const channel = await resolveResponseChannel(interaction, client);
      
      // Clean Level 3+ (remove cancel menu and show confirmation at Level 4)
      await cleanupService.cleanupFromLevel(userId, client, 3);
      
      // Show brief confirmation message at Level 4
      const confirmMsg = await channel.send({
        content: confirmMessage
      });
      
      // Track at Level 4 (confirmation message)
      cleanupService.trackMenuMessage(userId, 4, confirmMsg.id);
      
      // After a delay, clean Level 3+ and return to Level 2 summary
      setTimeout(async () => {
        try {
          await cleanupService.cleanupFromLevel(userId, client, 3);
          
          // Return to My Requests summary page (Level 2)
          await showRequestsMenu(interaction, client, userId, true);
        } catch (err) {
          log.error('[STATUS] Error returning to summary after cancel:', err);
        }
      }, config.confirmationMessageDelay);
      
      // Acknowledge the dropdown interaction
      await interaction.deferUpdate();
    }
  } catch (err) {
    console.error('[STATUS DROPDOWN] Error:', err);
    
    const userId = interaction.user.id;
    const channel = await resolveResponseChannel(interaction, client);
    
    // Clean Level 3+ and show error at Level 4
    await cleanupService.cleanupFromLevel(userId, client, 3);
    
    const errorMsg = await channel.send({
      content: '❌ An error occurred while cancelling the request.'
    });
    
    cleanupService.trackMenuMessage(userId, 4, errorMsg.id);
    
    // Return to summary after delay
    setTimeout(async () => {
      try {
        await cleanupService.cleanupFromLevel(userId, client, 3);
        await showRequestsMenu(interaction, client, userId, true);
      } catch (err2) {
        log.error('[STATUS] Error returning to summary after error:', err2);
      }
    }, config.confirmationMessageDelay);
    
    await interaction.deferUpdate();
  }
}

module.exports = { 
  handleStatusCommand,
  handleStatusButton,
  handleStatusDropdown
};
