// Helper for paginating crafter requests
function buildCrafterQueuePages(requests, crafterName, pageCharLimit = 1800) {
  let header = `👤 **Crafter Queue**\n\n**${crafterName}** has **${requests.length}** request(s):\n\n`;
  let pages = [];
  let current = header;
  for (const req of requests) {
    const indicator = getMaterialIndicator(req);
    let block = `• **#${req.id}** ${req.character} - ${req.profession.charAt(0).toUpperCase() + req.profession.slice(1)} - ${req.request_name} ${indicator}\n`;
    if ((current + block).length > pageCharLimit && current !== header) {
      pages.push(current);
      current = '';
    }
    current += block;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

async function handleAdminCrafterDropdown(interaction, client, page = 0) {
  const selectedValue = interaction.values ? interaction.values[0] : interaction.customId.split(':')[2];
  const crafterId = selectedValue.replace('crafter_', '');
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);

  // Clean Level 4+ (keep header, admin menu, and dropdown)
  await cleanupService.cleanupFromLevel(userId, client, 4);

  const requests = await db.getAllRequestsByClaimedUser(crafterId);
  const inProgress = requests.filter(r => r.status === 'in_progress' || r.status === 'claimed');
  const crafterName = requests[0]?.claimed_by_name || 'Unknown';

  if (inProgress.length === 0) {
    let content = `👤 **Crafter Queue**\n\n*This crafter has no in-progress requests.*\n`;
    const msg = await channel.send({ content });
    cleanupService.trackMenuMessage(userId, 4, msg.id);
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

  const pages = buildCrafterQueuePages(inProgress, crafterName);
  const totalPages = pages.length;
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));

  // Navigation buttons
  const components = [];
  const buttons = [];
  if (totalPages > 1) {
    if (currentPage > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`manage_crafts:admin_crafter_page_${crafterId}_${currentPage - 1}`)
          .setLabel('◀️ Previous')
          .setStyle(ButtonStyle.Primary)
      );
    }
    if (currentPage < totalPages - 1) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`manage_crafts:admin_crafter_page_${crafterId}_${currentPage + 1}`)
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Primary)
      );
    }
    components.push(new ActionRowBuilder().addComponents(buttons));
  }

  const msg = await channel.send({ content: pages[currentPage], components });
  cleanupService.trackMenuMessage(userId, 4, msg.id);
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

// Handler for crafter queue pagination
async function handleAdminCrafterPage(interaction, client) {
  const match = interaction.customId.match(/manage_crafts:admin_crafter_page_(.+)_(\d+)/);
  if (!match) return;
  const crafterId = match[1];
  const page = parseInt(match[2], 10);
  // Fake a select interaction for compatibility
  interaction.values = [`crafter_${crafterId}`];
  await handleAdminCrafterDropdown(interaction, client, page);
}
// interactions/shared/adminCraftsFlow.js
const { ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType } = require('discord.js');
const db = require('../../utils/database');
const config = require('../../config/config.js');
const { resolveResponseChannel } = require('../../utils/requestChannel');
const cleanupService = require('../../utils/cleanupService');
const log = require('../../utils/logWriter');

/**
 * Helper to determine material provision status for a request
 * Returns emoji indicator for Core guild crafting or user-provided materials
 */
function getMaterialIndicator(request) {
  if (!request.provides_materials) {
    return '🛡️';  // Guild Craft Full (Core member)
  }
  
  try {
    const providedMats = request.provided_materials_json ? JSON.parse(request.provided_materials_json) : {};
    const requiredPerUnit = request.materials_json ? JSON.parse(request.materials_json) : {};
    const qtyRequested = parseInt(request.quantity_requested || request.quantity || 1, 10);
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
        return '📦';  // Full materials provided
      } else {
        return '🔷';  // Partial materials (Core member only)
      }
    }
  } catch (err) {
    log.debug('[MATERIAL_INDICATOR] Failed to parse materials:', err);
  }
  
  return '';
}

/**
 * Admin Summary - Shows overview of all professions
 */

// Helper to build the summary string array (pages)
function buildProfessionSummaryPages(byProfession, pageCharLimit = 1800) {
  let header = '📊 **Profession Summary**\n\nOverview of all enabled professions:\n\n';
  let pages = [];
  let current = header;
  for (const [profession, data] of Object.entries(byProfession)) {
    const professionName = profession.charAt(0).toUpperCase() + profession.slice(1);
    const totalClaimed = Object.values(data.in_progress).reduce((sum, count) => sum + count, 0);
    const totalRequests = data.open + totalClaimed;
    const statusEmoji = totalRequests === 0 ? '✅' : data.open > 0 ? '⏳' : '⚙️';
    let block = `${statusEmoji} **${professionName}** (${totalRequests} total)\n`;
    block += `  Open: ${data.open} request(s)\n`;
    if (Object.keys(data.in_progress).length > 0) {
      block += `  Claimed:\n`;
      for (const [crafter, count] of Object.entries(data.in_progress)) {
        block += `    • ${crafter}: ${count} request(s)\n`;
      }
    } else {
      block += `  Claimed: 0 request(s)\n`;
    }
    block += '\n';
    if ((current + block).length > pageCharLimit && current !== header) {
      pages.push(current);
      current = '';
    }
    current += block;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

async function handleAdminSummary(interaction, client, page = 0) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);

  // Clean Level 3+ (keep header and admin menu)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  cleanupService.trackUserChannel(userId, channel.id);

  const summary = await db.getRequestSummary();

  // Initialize all enabled professions with 0 counts
  const byProfession = {};
  for (const prof of config.enabledProfessions) {
    byProfession[prof] = { open: 0, in_progress: {}, complete: 0 };
  }
  // Fill in actual data from database
  for (const row of summary) {
    if (!byProfession[row.profession]) {
      byProfession[row.profession] = { open: 0, in_progress: {}, complete: 0 };
    }
    if (row.status === 'open') {
      byProfession[row.profession].open += row.count;
    } else if (row.status === 'in_progress') {
      const crafterName = row.claimed_by_name || 'Unknown';
      byProfession[row.profession].in_progress[crafterName] =
        (byProfession[row.profession].in_progress[crafterName] || 0) + row.count;
    }
  }

  const pages = buildProfessionSummaryPages(byProfession);
  const totalPages = pages.length;
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));

  // Navigation buttons
  const components = [];
  const buttons = [];
  if (totalPages > 1) {
    if (currentPage > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`manage_crafts:admin_summary_page_${currentPage - 1}`)
          .setLabel('◀️ Previous')
          .setStyle(ButtonStyle.Primary)
      );
    }
    if (currentPage < totalPages - 1) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`manage_crafts:admin_summary_page_${currentPage + 1}`)
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Primary)
      );
    }
    components.push(new ActionRowBuilder().addComponents(buttons));
  }

  const msg = await channel.send({ content: pages[currentPage], components });
  cleanupService.trackMenuMessage(userId, 3, msg.id);

  // Schedule cleanup if user becomes inactive (SUBMENU = viewing summary)
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

// Handler for summary pagination
async function handleAdminSummaryPage(interaction, client) {
  const pageMatch = interaction.customId.match(/manage_crafts:admin_summary_page_(\d+)/);
  const page = pageMatch ? parseInt(pageMatch[1], 10) : 0;
  await handleAdminSummary(interaction, client, page);
}

/**
 * Admin View by Profession - Shows dropdown to select profession
 */
async function handleAdminByProfession(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);

  // Clean Level 3+ (keep header and admin menu)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  cleanupService.trackUserChannel(userId, channel.id);

  const options = config.enabledProfessions.map(prof => ({
    label: prof.charAt(0).toUpperCase() + prof.slice(1),
    value: `profession_${prof}`,
    emoji: '🔧'
  }));

  const dropdown = new StringSelectMenuBuilder()
    .setCustomId('manage_crafts:admin_profession_dropdown')
    .setPlaceholder('Select a profession')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(dropdown);

  const msg = await channel.send({
    content: `🔧 **View by Profession**\n\nSelect a profession to view its queue:`,
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
 * Handle profession dropdown selection
 */
async function handleAdminProfessionDropdown(interaction, client) {
  const selectedValue = interaction.values[0];
  const profession = selectedValue.replace('profession_', '');
  await showAdminProfessionQueue(interaction, client, profession, 0);
}

/**
 * Show profession queue with pagination
 */
async function showAdminProfessionQueue(interaction, client, profession, page = 0) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 4+ (keep header, admin menu, and dropdown)
  await cleanupService.cleanupFromLevel(userId, client, 4);

  const itemsPerPage = 20;
  const openRequests = await db.getOpenRequestsByProfession(profession);
  
  // Get all active requests and sort by request ID (order received)
  const allRequests = await db.getRequestsByProfession(profession, ['open', 'claimed', 'in_progress']);
  allRequests.sort((a, b) => a.id - b.id);

  const totalPages = Math.ceil(allRequests.length / itemsPerPage);
  const startIndex = page * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const requests = allRequests.slice(startIndex, endIndex);

  let content = `🔧 **${profession.charAt(0).toUpperCase() + profession.slice(1)} Queue**\n\n`;
  content += `**Open Requests:** ${openRequests.length}\n`;
  content += `**Total Active:** ${allRequests.length}\n`;
  
  if (totalPages > 1) {
    content += `**Page:** ${page + 1} of ${totalPages}\n`;
  }
  content += `\n`;

  if (allRequests.length === 0) {
    content += '*No active requests for this profession.*\n';
  } else {
    content += '**Requests (Ordered by Request Time):**\n\n';
    
    // Group by status for better readability
    const byStatus = {
      open: requests.filter(r => r.status === 'open'),
      claimed: requests.filter(r => r.status === 'claimed'),
      in_progress: requests.filter(r => r.status === 'in_progress')
    };

    // Show open requests first
    if (byStatus.open.length > 0) {
      content += `**⏳ OPEN (${byStatus.open.length}):**\n`;
      for (const req of byStatus.open) {
        const indicator = getMaterialIndicator(req);
          const qty = req.quantity_requested || req.quantity || 1;
          content += `#${req.id} | ${req.character} | ${req.request_name} x${qty} ${indicator}\n`;
      }
      content += `\n`;
    }

    // Show claimed requests
    if (byStatus.claimed.length > 0) {
      content += `**👤 CLAIMED (${byStatus.claimed.length}):**\n`;
      for (const req of byStatus.claimed) {
        const claimedBy = req.claimed_by_name || 'Unknown';
        const indicator = getMaterialIndicator(req);
          const qty = req.quantity_requested || req.quantity || 1;
          content += `#${req.id} | ${req.character} | ${req.request_name} x${qty} | By: ${claimedBy} ${indicator}\n`;
      }
      content += `\n`;
    }

    // Show in-progress requests
    if (byStatus.in_progress.length > 0) {
      content += `**⚙️ IN PROGRESS (${byStatus.in_progress.length}):**\n`;
      for (const req of byStatus.in_progress) {
        const claimedBy = req.claimed_by_name || 'Unknown';
        const indicator = getMaterialIndicator(req);
          const qty = req.quantity_requested || req.quantity || 1;
          content += `#${req.id} | ${req.character} | ${req.request_name} x${qty} | By: ${claimedBy} ${indicator}\n`;
      }
      content += `\n`;
    }
  }

  // Navigation buttons
  const components = [];
  const buttons = [];

  // Add pagination buttons only if there are multiple pages
  if (totalPages > 1) {
    if (page > 0) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`manage_crafts:admin_prof_page_${profession}_${page - 1}`)
          .setLabel('◀️ Previous')
          .setStyle(ButtonStyle.Primary)
      );
    }
    
    if (page < totalPages - 1) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`manage_crafts:admin_prof_page_${profession}_${page + 1}`)
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Primary)
      );
    }

    components.push(new ActionRowBuilder().addComponents(buttons));
  }

  const msg = await channel.send({ content, components });
  
  // Track at Level 4 (result display)
  cleanupService.trackMenuMessage(userId, 4, msg.id);
  
  // Schedule cleanup if user becomes inactive (SUBMENU = viewing profession queue)
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
 * Admin View by Crafter - Shows list of crafters with professions and permissions
 */
async function handleAdminByCrafter(interaction, client) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);

  // Clean Level 3+ (keep header and admin menu)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  cleanupService.trackUserChannel(userId, channel.id);

  const crafters = await db.getAllCraftersWithProfessions();

  if (crafters.length === 0) {
    const content = '❌ No crafters currently have claimed or completed requests.';
    const msg = await channel.send({ content });
    cleanupService.trackMenuMessage(userId, 3, msg.id);
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

  // Sort crafters by last_activity descending
  const sortedCrafters = crafters.slice().sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));
  const recentCrafters = sortedCrafters.slice(0, 5);

  // Get guild to check member roles
  const guild = client.guilds.cache.get(config.guildId);

  let content = `👤 **View by Crafter**\n\n`;
  content += `Showing 5 most recent crafters by activity:\n\n`;

  // Show only the 5 most recent crafters in the main section
  for (const crafter of recentCrafters) {
    const member = guild ? await guild.members.fetch(crafter.claimed_by).catch(() => null) : null;
    const professionsList = crafter.professions
      .map(p => p.charAt(0).toUpperCase() + p.slice(1))
      .join(', ');
    const permissions = [];
    if (member) {
      if (config.roles.admin && member.roles.cache.has(config.roles.admin)) {
        permissions.push('Admin');
      }
      for (const [profName, roleId] of Object.entries(config.roles.professions)) {
        if (roleId && member.roles.cache.has(roleId)) {
          permissions.push(profName.charAt(0).toUpperCase() + profName.slice(1));
        }
      }
    }
    const permissionStr = permissions.length > 0 ? ` [${permissions.join(', ')}]` : '';
    const lastActivity = new Date(crafter.last_activity).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    content += `**${crafter.claimed_by_name}**${permissionStr}\n`;
    content += `└ In Progress: ${crafter.in_progress_count} | Completed: ${crafter.completed_count} | Last: ${lastActivity}\n\n`;
  }

  // Dropdown still contains all crafters
  const options = crafters.map(crafter => ({
    label: crafter.claimed_by_name,
    value: `crafter_${crafter.claimed_by}`,
    emoji: '👤',
    description: `${crafter.in_progress_count} in progress, ${crafter.completed_count} completed`
  }));

  const dropdown = new StringSelectMenuBuilder()
    .setCustomId('manage_crafts:admin_crafter_dropdown')
    .setPlaceholder('Select a crafter to view their queue')
    .addOptions(options.slice(0, 25)); // Discord limit

  const row = new ActionRowBuilder().addComponents(dropdown);

  const msg = await channel.send({
    content,
    components: [row]
  });
  cleanupService.trackMenuMessage(userId, 3, msg.id);
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

/**
 * Handle crafter dropdown selection
 */
async function handleAdminCrafterDropdown(interaction, client) {
  const selectedValue = interaction.values[0];
  const crafterId = selectedValue.replace('crafter_', '');
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 4+ (keep header, admin menu, and dropdown)
  await cleanupService.cleanupFromLevel(userId, client, 4);

  const requests = await db.getAllRequestsByClaimedUser(crafterId);

  let content = `👤 **Crafter Queue**\n\n`;

  if (requests.length === 0) {
    content += '*This crafter has no requests.*\n';
  } else {
    const crafterName = requests[0].claimed_by_name || 'Unknown';
    content += `**${crafterName}** has **${requests.length}** request(s):\n\n`;

    // Group by status
    const byStatus = { in_progress: [], complete: [] };
    for (const req of requests) {
      if (byStatus[req.status]) {
        byStatus[req.status].push(req);
      }
    }

    if (byStatus.in_progress.length > 0) {
      content += `**In Progress (${byStatus.in_progress.length}):**\n`;
      for (const req of byStatus.in_progress) {
        const indicator = getMaterialIndicator(req);
        content += `• **#${req.id}** ${req.character} - ${req.profession.charAt(0).toUpperCase() + req.profession.slice(1)} - ${req.request_name} ${indicator}\n`;
      }
      content += '\n';
    }

    if (byStatus.complete.length > 0) {
      content += `**Completed (${byStatus.complete.length}):**\n`;
      // Show last 5 completed requests
      const recentCompleted = byStatus.complete.slice(0, 5);
      for (const req of recentCompleted) {
        const indicator = getMaterialIndicator(req);
        content += `• **#${req.id}** ${req.character} - ${req.profession.charAt(0).toUpperCase() + req.profession.slice(1)} - ${req.request_name} ${indicator}\n`;
      }
      if (byStatus.complete.length > 5) {
        content += `_... and ${byStatus.complete.length - 5} more completed_\n`;
      }
    }
  }

  const msg = await channel.send({ content });
  
  // Track at Level 4 (result display)
  cleanupService.trackMenuMessage(userId, 4, msg.id);
  
  // Schedule cleanup if user becomes inactive (SUBMENU = viewing crafter queue)
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
 * Admin Request Lookup - Show modal to enter request ID
 */
async function handleAdminLookup(interaction, client) {
  const userId = interaction.user.id;
  
  // Clean Level 3+ (keep header and admin menu)
  await cleanupService.cleanupFromLevel(userId, interaction.client, 3);
  
  const modal = new ModalBuilder()
    .setCustomId('manage_crafts:admin_lookup_modal')
    .setTitle('Request Lookup');

  const requestIdInput = new TextInputBuilder()
    .setCustomId('request_id')
    .setLabel('Request ID')
    .setPlaceholder('Enter request ID (e.g., 42)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(requestIdInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

/**
 * Handle admin lookup modal submission
 */
async function handleAdminLookupModal(interaction, client) {
  const requestId = parseInt(interaction.fields.getTextInputValue('request_id'));
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 4+ (keep header and admin menu)
  await cleanupService.cleanupFromLevel(userId, client, 4);

  try {
    const request = await db.getRequestById(requestId);

    if (!request) {
      await interaction.reply({
        content: `❌ Request #${requestId} not found.`,
        flags: 1 << 6
      });
      return;
    }

    await showRequestDetails(interaction, client, channel, request, true);
  } catch (err) {
    log.error('[ADMIN_CRAFTS] Failed to lookup request:', err);
    await interaction.reply({
      content: `❌ Failed to lookup request: ${err.message}`,
      flags: 1 << 6
    });
  }
}

/**
 * Show detailed request information
 */
async function showRequestDetails(interaction, client, channel, request, includeAuditLog = false) {
  const userId = interaction.user.id;

  let content = `🔍 **Request Details**\n\n`;
  content += `**Request ID:** #${request.id}\n`;
  content += `**Character:** ${request.character}\n`;
  content += `**Profession:** ${request.profession}\n`;
  content += `**Gear Slot:** ${request.gear_slot}\n`;
  content += `**Request:** ${request.request_name}\n`;
  // Quantity info
  const qtyRequested = parseInt(request.quantity_requested || request.quantity || 1, 10) || 1;
  const qtyCompleted = parseInt(request.quantity_completed || 0, 10) || 0;
  content += `**Quantity:** ${qtyRequested} requested, ${qtyCompleted} completed\n`;
  // Show user-friendly status label
  const statusLabel = request.status === 'denied' ? 'Cancelled' : request.status;
  content += `**Status:** ${statusLabel}\n`;
  
  if (request.status === 'denied' && request.deny_reason) {
    content += `**Cancellation Reason:** ${request.deny_reason}\n`;
  }
  
  if (request.claimed_by_name) {
    content += `**Claimed By:** ${request.claimed_by_name}\n`;
    content += `**Claimed At:** ${new Date(request.claimed_at).toLocaleString()}\n`;
  }
  
  content += `**Created:** ${new Date(request.created_at).toLocaleString()}\n`;
  content += `**Updated:** ${new Date(request.updated_at).toLocaleString()}\n\n`;

  // Materials
  if (request.materials_json) {
    const materials = JSON.parse(request.materials_json);
    if (Object.keys(materials).length > 0) {
      content += `**Materials Required (per unit):**\n`;
      for (const [mat, qty] of Object.entries(materials)) {
        content += `  • ${mat} x${qty}\n`;
      }
      // Totals for requested quantity
      if (qtyRequested > 1) {
        content += `**Total Required (for ${qtyRequested}):**\n`;
        for (const [mat, qty] of Object.entries(materials)) {
          const total = (parseInt(qty, 10) || 0) * qtyRequested;
          content += `  • ${mat} x${total}\n`;
        }
      }
      content += '\n';
    }
  }

  // Provided materials (these are totals across the request quantity)
  if (request.provided_materials_json) {
    const provided = JSON.parse(request.provided_materials_json);
    if (Object.keys(provided).length > 0) {
      content += `**Materials Provided (total):**\n`;
      for (const [mat, qty] of Object.entries(provided)) {
        content += `  • ${mat} x${qty}\n`;
      }
      content += '\n';
    }
  }

  // Audit log (admin only)
  if (includeAuditLog && request.audit_log) {
    const auditLog = JSON.parse(request.audit_log);
    if (auditLog.length > 0) {
      content += `**Audit Log:**\n`;
      for (const entry of auditLog) {
        const timestamp = new Date(entry.at).toLocaleString();
        content += `  • [${timestamp}] ${entry.action} by <@${entry.by}>\n`;
      }
    }
  }

  // Admin management buttons
  const components = [];
  if (includeAuditLog) {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`manage_crafts:admin_reassign_${request.id}`)
        .setLabel('Reassign Crafter')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('👤')
        .setDisabled(request.status === 'complete' || request.status === 'denied'),
      new ButtonBuilder()
        .setCustomId(`manage_crafts:admin_cancel_${request.id}`)
        .setLabel('Cancel Request')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌')
        .setDisabled(request.status === 'complete' || request.status === 'denied')
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`manage_crafts:admin_mark_complete_${request.id}`)
        .setLabel('Mark Complete')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅')
        .setDisabled(request.status === 'complete' || request.status === 'denied' || request.status === 'open'),
      new ButtonBuilder()
        .setCustomId(`manage_crafts:admin_reopen_${request.id}`)
        .setLabel('Reopen Request')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄')
        .setDisabled(request.status === 'open' || request.status === 'claimed' || request.status === 'in_progress')
    );

    components.push(row1, row2);
  }

  const msg = await channel.send({ content, components });
  
  // Track at Level 4 (result display)
  cleanupService.trackMenuMessage(userId, 4, msg.id);
  
  // Schedule cleanup if user becomes inactive (SUBMENU = request details view)
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
  
  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferUpdate();
  }
}

/**
 * Admin Audit Log - Show paginated list with option to search
 */
async function handleAdminAudit(interaction, client) {
  await showAuditLogList(interaction, client, 0);
}

/**
 * Show audit log list with pagination
 */
async function showAuditLogList(interaction, client, page = 0) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  
  // Clean Level 3+ (keep header and admin menu)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  cleanupService.trackUserChannel(userId, channel.id);

  const itemsPerPage = 10; // Reduced to prevent exceeding 2000 char limit
  
  // Get all requests ordered by submission time (newest to oldest)
  const allRequests = await db.getAllRequests();
  allRequests.sort((a, b) => b.id - a.id); // Reverse ID order = newest first

  const totalPages = Math.ceil(allRequests.length / itemsPerPage);
  const startIndex = page * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const requests = allRequests.slice(startIndex, endIndex);

  let content = `📜 **Audit Log - All Requests**\n\n`;
  content += `Total: **${allRequests.length}** | Page **${page + 1}**/**${totalPages}**\n\n`;

  if (requests.length === 0) {
    content += '*No requests found.*\n';
  } else {
    for (const req of requests) {
      const submittedDate = new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const submittedTime = new Date(req.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      
      // Truncate long item names to fit in character limit
      const baseName = req.request_name.length > 35 ? req.request_name.substring(0, 32) + '...' : req.request_name;
      const qty = parseInt(req.quantity_requested || req.quantity || 1, 10) || 1;
      const itemName = qty > 1 ? `${baseName} x${qty}` : baseName;
      
      content += `**#${req.id}** ${req.character} - ${itemName}\n`;
      content += `└ ${req.status} | ${submittedDate} ${submittedTime}\n\n`;
    }
  }

  // Navigation buttons
  const components = [];
  const row1Buttons = [];
  const row2Buttons = [];

  // Add pagination buttons only if there are multiple pages
  if (totalPages > 1) {
    if (page > 0) {
      row1Buttons.push(
        new ButtonBuilder()
          .setCustomId(`manage_crafts:audit_page_${page - 1}`)
          .setLabel('◀️ Previous')
          .setStyle(ButtonStyle.Primary)
      );
    }
    
    if (page < totalPages - 1) {
      row1Buttons.push(
        new ButtonBuilder()
          .setCustomId(`manage_crafts:audit_page_${page + 1}`)
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Primary)
      );
    }
  }

  if (row1Buttons.length > 0) {
    components.push(new ActionRowBuilder().addComponents(row1Buttons));
  }

  // Search button on second row
  row2Buttons.push(
    new ButtonBuilder()
      .setCustomId('manage_crafts:audit_search')
      .setLabel('🔍 Search by ID/Character')
      .setStyle(ButtonStyle.Secondary)
  );

  components.push(new ActionRowBuilder().addComponents(row2Buttons));

  const msg = await channel.send({ content, components });
  
  // Track at Level 3 (audit menu)
  cleanupService.trackMenuMessage(userId, 3, msg.id);
  
  // Schedule cleanup if user becomes inactive (SUBMENU = audit list)
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
 * Handle audit search button - Show modal to search by character name
 */
async function handleAdminAuditSearch(interaction, client) {
  const modal = new ModalBuilder()
    .setCustomId('manage_crafts:admin_audit_modal')
    .setTitle('Audit Log - Search by Character');

  const searchInput = new TextInputBuilder()
    .setCustomId('search_term')
    .setLabel('Character Name')
    .setPlaceholder('Enter character name to search')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(searchInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

/**
 * Handle audit search modal submission
 */
async function handleAdminAuditModal(interaction, client) {
  const searchTerm = interaction.fields.getTextInputValue('search_term');
  await showAuditLogSearchResults(interaction, client, searchTerm, 0);
}

/**
 * Show paginated search results for character name
 */
async function showAuditLogSearchResults(interaction, client, characterName, page = 0) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);
  // Ensure channel is tracked so cleanupFromLevel can delete previous pages
  cleanupService.trackUserChannel(userId, channel.id);
  
  // Clean Level 4+ (keep header and audit list)
  await cleanupService.cleanupFromLevel(userId, client, 4);

  try {
    // Search by character name
    const allRequests = await db.getRequestsByCharacterName(characterName);
    
    if (allRequests.length === 0) {
      const content = `❌ No requests found for character "${characterName}".`;
      const msg = await channel.send({ content });
      
      // Track at Level 4
      cleanupService.trackMenuMessage(userId, 4, msg.id);
      
      // Schedule cleanup
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
      
      if (interaction.isModalSubmit()) {
        await interaction.deferUpdate();
      } else {
        await interaction.deferUpdate();
      }
      return;
    }

    // Sort by newest first (reverse ID order)
    allRequests.sort((a, b) => b.id - a.id);

    const itemsPerPage = 10; // Reduced to prevent exceeding 2000 char limit
    const totalPages = Math.ceil(allRequests.length / itemsPerPage);
    const startIndex = page * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const requests = allRequests.slice(startIndex, endIndex);

    let content = `📜 **Audit Log - Search: "${characterName}"**\n\n`;
    content += `Total: **${allRequests.length}** | Page **${page + 1}**/**${totalPages}**\n\n`;

    for (const req of requests) {
      const submittedDate = new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const submittedTime = new Date(req.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      
      // Truncate long item names to fit in character limit
      const baseName = req.request_name.length > 35 ? req.request_name.substring(0, 32) + '...' : req.request_name;
      const qty = parseInt(req.quantity_requested || req.quantity || 1, 10) || 1;
      const itemName = qty > 1 ? `${baseName} x${qty}` : baseName;
      
      content += `**#${req.id}** ${req.character} - ${itemName}\n`;
      content += `└ ${req.status} | ${submittedDate} ${submittedTime}\n\n`;
    }

    // Navigation buttons
    const components = [];
    const buttons = [];

    // Add pagination buttons only if there are multiple pages
    if (totalPages > 1) {
      if (page > 0) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`manage_crafts:audit_search_page_${characterName}_${page - 1}`)
            .setLabel('◀️ Previous')
            .setStyle(ButtonStyle.Primary)
        );
      }
      
      if (page < totalPages - 1) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`manage_crafts:audit_search_page_${characterName}_${page + 1}`)
            .setLabel('Next ▶️')
            .setStyle(ButtonStyle.Primary)
        );
      }

      components.push(new ActionRowBuilder().addComponents(buttons));
    }

    const msg = await channel.send({ content, components });
    
    // Track at Level 4 (search results)
    cleanupService.trackMenuMessage(userId, 4, msg.id);
    
    // Schedule cleanup if user becomes inactive
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
    
    if (interaction.isModalSubmit()) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferUpdate();
    }
  } catch (err) {
    log.error('[ADMIN_CRAFTS] Failed to search audit log:', err);
    const errorMsg = `❌ Failed to search audit log: ${err.message}`;
    const msg = await channel.send({ content: errorMsg });
    
    // Track at Level 4
    cleanupService.trackMenuMessage(userId, 4, msg.id);
    
    if (interaction.isModalSubmit()) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferUpdate();
    }
  }
}

/**
 * Back to admin menu handler
 */
async function handleBackToAdminMenu(interaction, client) {
  const userId = interaction.user.id;
  
  // Clean Level 3+ (keep header and admin menu)
  await cleanupService.cleanupFromLevel(userId, client, 3);
  
  // Re-show admin menu
  const { handleManageRequestsMain } = require('./manageCraftsFlow');
  await handleManageRequestsMain(interaction, client);
}

/**
 * Handle pagination for profession queue
 */
async function handleAdminProfessionPage(interaction, client, profession, page) {
  await showAdminProfessionQueue(interaction, client, profession, page);
}

/**
 * Handle pagination for audit log list
 */
async function handleAdminAuditPage(interaction, client, page) {
  await showAuditLogList(interaction, client, page);
}

/**
 * Handle pagination for audit search results
 */
async function handleAdminAuditSearchPage(interaction, client, characterName, page) {
  await showAuditLogSearchResults(interaction, client, characterName, page);
}

/**
 * Handle admin reassign crafter button - show dropdown of crafters with matching profession
 */
async function handleAdminReassign(interaction, client, requestId) {
  try {
    const request = await db.getRequestById(requestId);
    
    if (!request) {
      await interaction.reply({
        content: `❌ Request #${requestId} not found.`,
        flags: 1 << 6
      });
      return;
    }

    // Get all guild members with the matching profession role
    const guild = await client.guilds.fetch(config.guildId);
    await guild.members.fetch(); // Fetch all members
    
    const professionRoleId = config.professionRoles[request.profession];
    if (!professionRoleId) {
      await interaction.reply({
        content: `❌ No role configured for profession: ${request.profession}`,
        flags: 1 << 6
      });
      return;
    }

    const crafters = guild.members.cache.filter(member => 
      member.roles.cache.has(professionRoleId) && !member.user.bot
    );

    if (crafters.size === 0) {
      await interaction.reply({
        content: `❌ No crafters found with ${request.profession} profession role.`,
        flags: 1 << 6
      });
      return;
    }

    // Build dropdown options (max 25)
    const options = crafters.map(member => ({
      label: (member.nickname || member.displayName || member.user.username).slice(0, 100),
      value: member.user.id,
      description: `${member.user.tag}`.slice(0, 100)
    })).slice(0, 25);

    const dropdown = new StringSelectMenuBuilder()
      .setCustomId(`manage_crafts:admin_reassign_select_${requestId}`)
      .setPlaceholder('Select a crafter to reassign to...')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(dropdown);

    await interaction.reply({
      content: `**Reassign Request #${requestId}**\n\nSelect a crafter with the **${request.profession}** profession:`,
      components: [row],
      flags: 1 << 6
    });
  } catch (err) {
    log.error('[ADMIN_CRAFTS] Failed to show reassign dropdown:', err);
    await interaction.reply({
      content: `❌ Failed to load crafters: ${err.message}`,
      flags: 1 << 6
    });
  }
}

/**
 * Handle admin reassign dropdown selection
 */
async function handleAdminReassignSelect(interaction, client, requestId) {
  const newCrafterId = interaction.values[0];
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);

  try {
    const request = await db.getRequestById(requestId);
    
    if (!request) {
      await interaction.update({
        content: `❌ Request #${requestId} not found.`,
        components: []
      });
      return;
    }

    // Get new crafter's member to get username
    const guild = await client.guilds.fetch(config.guildId);
    const newCrafter = await guild.members.fetch(newCrafterId);
    
    if (!newCrafter) {
      await interaction.update({
        content: `❌ User with ID ${newCrafterId} not found in server.`,
        components: []
      });
      return;
    }

    // Update the request with new crafter
    await db.run(
      `UPDATE requests 
       SET claimed_by = ?, 
           claimed_by_name = ?, 
           claimed_at = ?,
           status = 'claimed',
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [newCrafterId, (newCrafter.nickname || newCrafter.displayName || newCrafter.user.username), new Date().toISOString(), requestId]
    );

    // Append audit log
    await db.appendAuditLog(requestId, 'Request reassigned', userId);

    // Notify old crafter if there was one
    if (request.claimed_by && request.claimed_by !== newCrafterId) {
      try {
        const oldCrafter = await client.users.fetch(request.claimed_by);
        await oldCrafter.send(
          `⚠️ Request #${requestId} has been reassigned to another crafter.\n\n` +
          `**Request:** ${request.request_name} for ${request.character}\n` +
          `**Profession:** ${request.profession.charAt(0).toUpperCase() + request.profession.slice(1)}`
        ).catch(err => log.warn(`[ADMIN_CRAFTS] Could not notify old crafter: ${err.message}`));
      } catch (err) {
        log.warn(`[ADMIN_CRAFTS] Could not fetch old crafter: ${err.message}`);
      }
    }

    // Notify new crafter
    try {
      await newCrafter.user.send(
        `✅ You have been assigned a request by an admin.\n\n` +
        `**Request #${requestId}**\n` +
        `**For:** ${request.character}\n` +
        `**Profession:** ${request.profession.charAt(0).toUpperCase() + request.profession.slice(1)}\n` +
        `**Item:** ${request.request_name} to ${request.gear_slot}\n\n` +
        `Use the Manage Requests menu to view details.`
      ).catch(err => log.warn(`[ADMIN_CRAFTS] Could not notify new crafter: ${err.message}`));
    } catch (err) {
      log.warn(`[ADMIN_CRAFTS] Could not fetch new crafter: ${err.message}`);
    }

    await interaction.update({
      content: `✅ Request #${requestId} has been reassigned to ${newCrafter.nickname || newCrafter.displayName || newCrafter.user.username}.`,
      components: []
    });

    // Refresh the request details
    const updatedRequest = await db.getRequestById(requestId);
    await cleanupService.cleanupFromLevel(userId, client, 4);
    await showRequestDetails(interaction, client, channel, updatedRequest, true);
  } catch (err) {
    log.error('[ADMIN_CRAFTS] Failed to reassign request:', err);
    await interaction.update({
      content: `❌ Failed to reassign request: ${err.message}`,
      components: []
    });
  }
}

/**
 * Handle admin cancel request button - show modal for reason
 */
async function handleAdminCancel(interaction, client, requestId) {
  const modal = new ModalBuilder()
    .setCustomId(`manage_crafts:admin_cancel_modal_${requestId}`)
    .setTitle('Cancel Request');

  const reasonInput = new TextInputBuilder()
    .setCustomId('cancel_reason')
    .setLabel('Cancellation Reason')
    .setPlaceholder('Enter reason for cancellation (visible to requester)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  const row = new ActionRowBuilder().addComponents(reasonInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

/**
 * Handle admin cancel modal submission
 */
async function handleAdminCancelModal(interaction, client, requestId) {
  const cancelReason = interaction.fields.getTextInputValue('cancel_reason');
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);

  try {
    const request = await db.getRequestById(requestId);
    
    if (!request) {
      await interaction.reply({
        content: `❌ Request #${requestId} not found.`,
        flags: 1 << 6
      });
      return;
    }

    // Update request status to denied and store cancellation reason
    await db.run(
      `UPDATE requests 
       SET status = 'denied',
           deny_reason = ?,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [cancelReason, requestId]
    );

    // Append audit log
    await db.appendAuditLog(requestId, `Request cancelled by admin: ${cancelReason}`, userId);

    // Notify requester
    if (request.user_id) {
      try {
        const requesterUser = await client.users.fetch(request.user_id);
        await requesterUser.send(
          `❌ Your request **#${requestId}** for **${request.request_name}** on **${request.character}** has been cancelled by an administrator.\n\n` +
          `**Reason:** ${cancelReason}`
        );
      } catch (err) {
        log.warn(`[ADMIN_CRAFTS] Could not DM requester ${request.user_id}:`, err);
      }
    }

    await interaction.reply({
      content: `✅ Request #${requestId} has been cancelled. Requester has been notified.`,
      flags: 1 << 6
    });

    // Refresh the request details
    const updatedRequest = await db.getRequestById(requestId);
    await cleanupService.cleanupFromLevel(userId, client, 4);
    await showRequestDetails(interaction, client, channel, updatedRequest, true);
  } catch (err) {
    log.error('[ADMIN_CRAFTS] Failed to cancel request:', err);
    await interaction.reply({
      content: `❌ Failed to cancel request: ${err.message}`,
      flags: 1 << 6
    });
  }
}

/**
 * Handle admin mark complete button
 */
async function handleAdminMarkComplete(interaction, client, requestId) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);

  try {
    const request = await db.getRequestById(requestId);
    
    if (!request) {
      await interaction.reply({
        content: `❌ Request #${requestId} not found.`,
        flags: 1 << 6
      });
      return;
    }

    // Instead of immediately completing, prompt admin for completed quantity
    const qtyRequested = parseInt(request.quantity_requested || request.quantity || 1, 10) || 1;
    const qtyCompleted = parseInt(request.quantity_completed || 0, 10) || 0;
    const remaining = Math.max(0, qtyRequested - qtyCompleted);

    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
    const modal = new ModalBuilder()
      .setCustomId(`complete_modal_${requestId}`)
      .setTitle('Mark Request Complete (Admin)');

    const input = new TextInputBuilder()
      .setCustomId('completed_qty')
      .setLabel(`Completed (remaining: ${remaining})`)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(String(remaining))
      .setRequired(true)
      .setValue(String(remaining));

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return;
  } catch (err) {
    log.error('[ADMIN_CRAFTS] Failed to mark request complete:', err);
    await interaction.reply({
      content: `❌ Failed to mark request complete: ${err.message}`,
      flags: 1 << 6
    });
  }
}

/**
 * Handle admin reopen request button
 */
async function handleAdminReopen(interaction, client, requestId) {
  const userId = interaction.user.id;
  const channel = await resolveResponseChannel(interaction, client);

  try {
    const request = await db.getRequestById(requestId);
    
    if (!request) {
      await interaction.reply({
        content: `❌ Request #${requestId} not found.`,
        flags: 1 << 6
      });
      return;
    }

    // Reopen request by setting status back to open and clearing crafter
    await db.run(
      `UPDATE requests 
       SET status = 'open',
           claimed_by = NULL,
           claimed_by_name = NULL,
           claimed_at = NULL,
           deny_reason = NULL,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [requestId]
    );

    // Append audit log
    await db.appendAuditLog(requestId, 'Request reopened by admin', userId);

    await interaction.reply({
      content: `✅ Request #${requestId} has been reopened.`,
      flags: 1 << 6
    });

    // Refresh the request details
    const updatedRequest = await db.getRequestById(requestId);
    await cleanupService.cleanupFromLevel(userId, client, 4);
    await showRequestDetails(interaction, client, channel, updatedRequest, true);
  } catch (err) {
    log.error('[ADMIN_CRAFTS] Failed to reopen request:', err);
    await interaction.reply({
      content: `❌ Failed to reopen request: ${err.message}`,
      flags: 1 << 6
    });
  }
}

module.exports = {
  handleAdminSummary,
  handleAdminSummaryPage,
  handleAdminByProfession,
  handleAdminProfessionDropdown,
  handleAdminByCrafter,
  handleAdminCrafterDropdown,
  handleAdminCrafterPage,
  handleAdminLookup,
  handleAdminLookupModal,
  handleAdminAudit,
  handleAdminAuditSearch,
  handleAdminAuditModal,
  handleAdminAuditPage,
  handleAdminAuditSearchPage,
  handleAdminReassign,
  handleAdminReassignSelect,
  handleAdminCancel,
  handleAdminCancelModal,
  handleAdminMarkComplete,
  handleAdminReopen,
  handleBackToAdminMenu,
  handleAdminProfessionPage,
  showRequestDetails
};
