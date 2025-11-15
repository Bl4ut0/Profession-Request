const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');

const db = require('../../utils/database');
const config = require('../../config/config.js');
const { getRecipes, getGearSlots } = require('../../utils/professionLoader');
const { storeTempSession, getTempSession } = require('../../utils/database');
const { resolveResponseChannel } = require('../../utils/requestChannel');
const cleanupService = require('../../utils/cleanupService');
const { getNavigationMessage } = require('../../utils/navigationHelper');
const { ensureDMMenu } = require('../../utils/dmMenu');
const log = require('../../utils/logWriter');

/** Helper to generate unique per-user session keys */
let keyCounter = 0;
function _tempKey(userId) {
  // Use timestamp + counter to ensure uniqueness within same millisecond
  // Reset counter after 10000 to prevent overflow
  keyCounter = (keyCounter + 1) % 10000;
  return `req_${userId}_${Date.now()}_${keyCounter}`;
}

/**
 * Creates a consistent header for the request flow messages.
 * @param {import('discord.js').Interaction} interaction
 * @param {string} title
 * @param {string} description
 */
function requestHeader(interaction, title, description) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
    .setDescription(description + '\n\u200B') // Add spacing before buttons
    .setTimestamp();
}

/**
 * Starts the dropdown flow with character selection.
 */
async function handleRequestFlow(interaction, client) {
  const userId = interaction.user.id;
  const chars = await db.getCharactersByUser(userId);
  if (!chars.length) {
    // User has no characters - need to open character management
    const { hasRegisterRole } = require('../../utils/permissionChecks');
    const { handleCharacterManagement } = require('./characterFlow');
    
    // Check if user has permission to register
    let member = interaction.member;
    if (!member) {
      // In DM context, fetch member from guild
      try {
        const guild = await client.guilds.fetch(config.guildId);
        member = await guild.members.fetch(userId);
      } catch (err) {
        log.error('[REQUEST_FLOW] Failed to fetch guild member:', err);
        if (!interaction.replied && !interaction.deferred) {
          return interaction.reply({
            content: '\u274c Unable to verify permissions. Please try again.',
            flags: MessageFlags.Ephemeral
          });
        }
        return;
      }
    }
    
    if (!hasRegisterRole(member)) {
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: '\u274c You do not have permission to register characters.',
          flags: MessageFlags.Ephemeral
        });
      }
      return;
    }
    
    // Send ephemeral message in main channel (exempt from config)
    const channelMessage = config.requestMode === 'dm'
      ? '📝 You need to register a character before creating a request. Check your DMs to continue.'
      : '📝 You need to register a character before creating a request. Check the character management menu to continue.';
    
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({
        content: channelMessage,
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Resolve response channel (DM or temp channel based on config)
    const channel = await resolveResponseChannel(interaction, client);
    // NOTE: resolveResponseChannel already calls ensureDMMenu in DM mode
    
    // Track channel BEFORE cleanup
    cleanupService.trackUserChannel(userId, channel.id);
    
    // Clear ALL other Level 1 flows (character registration is a separate flow)
    await cleanupService.cleanupAllFlowMessages(userId, client);
    cleanupService.clearMenuHierarchy(userId);
    
    // Schedule cleanup if in channel mode
    if (config.requestMode === 'channel' && channel.type === ChannelType.GuildText) {
      cleanupService.scheduleChannelDeletion(channel);
    }
    
    // Send full character management menu to the resolved channel
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
    
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('char_register_start')
        .setLabel('Register New Character')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('char_view')
        .setLabel('View My Characters')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('char_delete_start')
        .setLabel('Delete a Character')
        .setStyle(ButtonStyle.Danger)
    );

    const msg1 = await channel.send({
      content: '👤 **Character Management**\n\nSelect an option below to manage your registered characters.',
      components: [row1],
    });
    
    // Track at Level 2 (main character menu - ANCHOR POINT, matching characterFlow)
    cleanupService.trackMenuMessage(userId, 2, msg1.id);
    
    // Automatically proceed to character type selection
    const row2 = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('char_register_type_select')
        .setPlaceholder('Select character type')
        .addOptions([
          { label: 'Main', value: 'main' },
          { label: 'Alt', value: 'alt' },
        ])
    );

    const msg2 = await channel.send({
      content: 'Please select the type of character you want to register.',
      components: [row2],
    });
    
    // Track at Level 3 (character type selection - one level deeper than anchor)
    cleanupService.trackMenuMessage(userId, 3, msg2.id);
    
    return;
  }

  // Resolve DM or temp channel
  const channel = await resolveResponseChannel(interaction, client);
  // NOTE: resolveResponseChannel already calls ensureDMMenu in DM mode

  // ** TRACK then CLEANUP: Clear ALL other Level 1 flows before starting request flow **
  cleanupService.trackUserChannel(userId, channel.id);
  await cleanupService.cleanupAllFlowMessages(userId, client);
  cleanupService.clearMenuHierarchy(userId);

  // If we are in a temporary channel, schedule it for deletion.
  if (config.requestMode === 'channel' && channel.type === ChannelType.GuildText) {
    cleanupService.scheduleChannelDeletion(channel);
  }

  // Build character dropdown
  const options = chars.map(c => ({
    label: `${c.name} (${c.type})`,
    value: c.name
  }));
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('request_character')
      .setPlaceholder('Choose a character')
      .addOptions(options.slice(0, 25))
  );

  const embed = requestHeader(interaction, 'New Request', 'Who is this request for?');

  // Send the first prompt
  const msg = await channel.send({
    embeds: [embed],
    components: [row]
  });

  // Confirm to the user (only if needed)
  // Check if interaction is still valid before responding
  if (interaction.replied || interaction.deferred) {
    log.debug('[REQUEST_FLOW] Interaction already handled, skipping response');
    return;
  }

  const followUp = getNavigationMessage(interaction, channel);
  if (followUp) {
    try {
      await interaction.reply({
        content: followUp,
        flags: MessageFlags.Ephemeral
      });
    } catch (err) {
      if (err.code === 10062) {
        log.debug('[REQUEST_FLOW] Interaction expired, but flow started successfully');
      } else {
        throw err;
      }
    }
  } else {
    // In DM, just acknowledge without message
    try {
      await interaction.deferUpdate();
    } catch (err) {
      if (err.code === 10062) {
        log.debug('[REQUEST_FLOW] Interaction expired, but flow started successfully');
      } else {
        throw err;
      }
    }
  }
}

/** Handles each step in the dropdown-based request flow */
async function handleRequestDropdowns(interaction, client) {
  const id = interaction.customId;
  const vals = interaction.values;
  const userId = interaction.user.id;

  log.debug(
    `[DROPDOWN] id=${id} user=${interaction.user.tag} vals=${JSON.stringify(vals)}`
  );

  try {
    // 1) Character chosen
    if (id === 'request_character') {
      const selected = vals[0];
      const profs = config.enabledProfessions;
      const opts = profs.map(p => ({
        label: p[0].toUpperCase() + p.slice(1),
        value: `${selected}::${p}`
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('request_profession')
          .setPlaceholder('Choose a profession')
          .addOptions(opts.slice(0, 25))
      );
      const embed = requestHeader(interaction, 'New Request', `What profession is this request for, **${selected}**?`);
      return interaction.update({
        embeds: [embed],
        components: [row]
      });
    }

    // 2) Profession chosen
    if (id === 'request_profession') {
      const [charName, profession] = vals[0].split('::');
      const availableSlots = getGearSlots(profession);
      const slots = config.enabledGearSlots.filter(
        slot => availableSlots.includes(slot) && getRecipes(profession, slot).length > 0
      );
      if (!slots.length) {
        const embed = requestHeader(interaction, 'New Request', `⚠️ No gear slots configured for **${profession}**.`);
        return interaction.update({
          embeds: [embed],
          components: []
        });
      }
      const opts = slots.map(slot => ({
        label: slot,
        value: `${charName}::${profession}::${slot}`
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('request_slot')
          .setPlaceholder('Select gear slot')
          .addOptions(opts.slice(0, 25))
      );
      const embed = requestHeader(interaction, 'New Request', `Which gear slot on **${charName}** for **${profession}**?`);
      return interaction.update({
        embeds: [embed],
        components: [row]
      });
    }

    // 3) Slot chosen
    if (id === 'request_slot') {
      const [charName, profession, slot] = vals[0].split('::');
      const recipes = getRecipes(profession, slot);
      
      if (!recipes.length) {
        const embed = requestHeader(interaction, 'New Request', `⚠️ No items for slot **${slot}**.`);
        return interaction.update({
          embeds: [embed],
          components: []
        });
      }

      // ** PAGINATION: Handle more than 25 recipes (Discord limit) **
      const ITEMS_PER_PAGE = 24; // Leave room for "Next Page" option if needed
      const totalPages = Math.ceil(recipes.length / ITEMS_PER_PAGE);
      const currentPage = 1; // First page
      
      const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
      const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, recipes.length);
      const pageRecipes = recipes.slice(startIdx, endIdx);

      const opts = pageRecipes.map(e => {
        const key = _tempKey(userId);
        log.debug(`[REQUEST_FLOW] Generated session key: ${key} for user: ${userId}`);
        storeTempSession(key, userId, {
          character: charName,
          profession,
          gearSlot: slot,
          requestId: e.name,
          requestName: e.name,
          materials: e.materials
        });
        log.debug(`[REQUEST_FLOW] Stored session data for key: ${key}`);
        return { label: e.name.slice(0, 100), value: key };
      });

      // Add "Next Page" option if there are more pages
      if (totalPages > 1) {
        opts.push({
          label: `📄 Next Page (${currentPage + 1}/${totalPages})`,
          value: `pagination::${charName}::${profession}::${slot}::${currentPage + 1}`
        });
      }

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('request_enchant')
          .setPlaceholder('Choose an option')
          .addOptions(opts)
      );
      
      let description = `✨ Choose an option for **${slot}** on **${charName}**:`;
      if (totalPages > 1) {
        description += `\n\n📄 Showing page ${currentPage} of ${totalPages} (${recipes.length} total items)`;
      }
      
      const embed = requestHeader(interaction, 'New Request', description);
      return interaction.update({
        embeds: [embed],
        components: [row]
      });
    }

    // 4) Enchant/item chosen → ask about materials (or handle pagination)
    if (id === 'request_enchant') {
      const key = vals[0];
      
      // ** PAGINATION: Check if this is a pagination request **
      if (key.startsWith('pagination::')) {
        const [_, charName, profession, slot, pageStr] = key.split('::');
        const currentPage = parseInt(pageStr);
        const recipes = getRecipes(profession, slot);
        
        const ITEMS_PER_PAGE = 24;
        const totalPages = Math.ceil(recipes.length / ITEMS_PER_PAGE);
        
        const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
        const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, recipes.length);
        const pageRecipes = recipes.slice(startIdx, endIdx);

        const opts = pageRecipes.map(e => {
          const sessionKey = _tempKey(userId);
          storeTempSession(sessionKey, userId, {
            character: charName,
            profession,
            gearSlot: slot,
            requestId: e.name,
            requestName: e.name,
            materials: e.materials
          });
          return { label: e.name.slice(0, 100), value: sessionKey };
        });

        // Add pagination options
        const paginationOpts = [];
        
        // Previous page option
        if (currentPage > 1) {
          paginationOpts.push({
            label: `⬅️ Previous Page (${currentPage - 1}/${totalPages})`,
            value: `pagination::${charName}::${profession}::${slot}::${currentPage - 1}`
          });
        }
        
        // Next page option
        if (currentPage < totalPages) {
          paginationOpts.push({
            label: `➡️ Next Page (${currentPage + 1}/${totalPages})`,
            value: `pagination::${charName}::${profession}::${slot}::${currentPage + 1}`
          });
        }

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('request_enchant')
            .setPlaceholder('Choose an option')
            .addOptions([...opts, ...paginationOpts])
        );
        
        const description = `✨ Choose an option for **${slot}** on **${charName}**:\n\n📄 Page ${currentPage} of ${totalPages} (${recipes.length} total items)`;
        const embed = requestHeader(interaction, 'New Request', description);
        
        return interaction.update({
          embeds: [embed],
          components: [row]
        });
      }
      
      // Normal flow: Enchant selected
      log.debug(`[REQUEST_FLOW] Retrieving session for key: ${key}`);
      const data = await getTempSession(key);
      if (!data) {
        log.error(`[REQUEST_FLOW] Session not found for key: ${key}. User: ${userId}`);
        const embed = requestHeader(interaction, 'New Request', '⚠️ Session expired. Please start over.');
        return interaction.update({
          embeds: [embed],
          components: []
        });
      }
      log.debug(`[REQUEST_FLOW] Session data found for key: ${key}`);

      const matList = Object.entries(data.materials)
        .map(([m, q]) => `• **${m}** — x${q}`)
        .join('\n');
      
      // Check if user has Core role for guild crafting
      const guild = client.guilds.cache.get(config.guildId);
      const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
      const hasCoreRole = member && config.coreRoleId && member.roles.cache.has(config.coreRoleId);
      
      const buttons = [
        new ButtonBuilder()
          .setCustomId(`provide_mats_some_${key}`)
          .setLabel('Provide Materials')
          .setStyle(ButtonStyle.Primary)
      ];
      
      // Only show Guild Craft button if user has Core role
      if (hasCoreRole) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`provide_mats_none_${key}`)
            .setLabel('Guild Craft')
            .setStyle(ButtonStyle.Secondary)
        );
      }
      
      const row = new ActionRowBuilder().addComponents(buttons);

      // Parse enchant name to extract slot and effect
      // E.g., "Enchant Shield - Critical Strike" becomes slot="Shield", effect="Critical Strike"
      const enchantMatch = data.requestName.match(/^Enchant (?:2H )?(.+?) - (.+)$/);
      const slot = enchantMatch ? enchantMatch[1] : data.gearSlot;
      const effect = enchantMatch ? enchantMatch[2] : data.requestName;

      // Calculate total cost summary
      const totalItems = Object.values(data.materials).reduce((sum, qty) => sum + qty, 0);
      const materialCount = Object.keys(data.materials).length;
      
      const embed = requestHeader(interaction, 'New Request', hasCoreRole 
        ? `Choose how to fulfill this request:` 
        : `Confirm your material provision:`)
        .addFields(
          {
            name: '🎯 Gear Slot',
            value: `**${slot}**`,
            inline: true
          },
          {
            name: '✨ Enchantment',
            value: `**${effect}**`,
            inline: true
          },
          {
            name: '💰 Cost',
            value: `**${materialCount}** types\n**${totalItems}** total`,
            inline: true
          },
          {
            name: '📦 Required Materials',
            value: matList,
            inline: false
          }
        );
      
      // Add info footer based on permission level
      if (hasCoreRole) {
        embed.setFooter({ text: '🛡️ Core Member: Choose guild crafting or provide materials yourself' });
      } else {
        embed.setFooter({ text: 'ℹ️ You must provide all required materials to proceed' });
      }
      
      await interaction.update({
        embeds: [embed],
        components: [row]
      });
    }
  } catch (err) {
    log.error('Request flow error:', err);
    try {
      await interaction.channel.send({ content: 'An error occurred.' });
    } catch {}
  }
}

async function finalizeRequest(interaction, client, providedMaterialsObj) {
    // Handle both button interactions (has customId) and modal submissions
    const key = interaction.customId 
        ? interaction.customId.split('_').slice(3).join('_')
        : interaction.customId.split('_').slice(3).join('_');
    
    log.debug(`[REQUEST_FLOW] Finalizing request. Retrieving session for key: ${key}`);
    const data = await getTempSession(key);
    if (!data) {
        log.error(`[REQUEST_FLOW] Session not found during finalization for key: ${key}. User: ${interaction.user.id}`);
        const embed = requestHeader(interaction, 'New Request', '⚠️ Session expired. Please start over.');
        
        // Handle both interaction types
        if (interaction.isModalSubmit()) {
            return interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral
            });
        } else {
            return interaction.update({
                embeds: [embed],
                components: []
            });
        }
    }
    log.debug(`[REQUEST_FLOW] Session data found for finalization. Key: ${key}`);

    // Check for duplicates within the last 5 seconds
    const isDuplicate = await db.checkDuplicateRequest(
      interaction.user.id,
      data.character,
      data.profession,
      data.gearSlot,
      data.requestId,
      5000 // 5 second window
    );

    if (isDuplicate) {
      log.warn(`[REQUEST_FLOW] Duplicate request detected for user ${interaction.user.id}`);
      const embed = requestHeader(interaction, 'Duplicate Request', '⚠️ You just submitted this request. Please wait a moment before submitting again.');
      
      if (interaction.isModalSubmit()) {
          return interaction.reply({
              embeds: [embed],
              flags: MessageFlags.Ephemeral
          });
      } else {
          return interaction.update({
              embeds: [embed],
              components: []
          });
      }
    }

    // Determine if providing any materials
    const hasProvidedMaterials = Object.values(providedMaterialsObj).some(qty => qty > 0);

    // Persist to database
    await db.addRequest({
        user_id: interaction.user.id,
        character: data.character,
        profession: data.profession,
        gear_slot: data.gearSlot,
        request_id: data.requestId,
        request_name: data.requestName,
        materials_json: JSON.stringify(data.materials),
        provided_materials_json: JSON.stringify(providedMaterialsObj),
        provides_materials: hasProvidedMaterials ? 1 : 0,
    });
    
    await db.logAction(interaction.user.id, 'createRequest', null, {
        character: data.character,
        item: data.requestName,
        slot: data.gearSlot,
        provides_materials: hasProvidedMaterials,
    });

    // Build detailed materials status
    const providedList = [];
    const neededList = [];
    
    for (const [material, required] of Object.entries(data.materials)) {
        const provided = providedMaterialsObj[material] || 0;
        const needed = required - provided;
        
        if (provided > 0) {
            providedList.push(`${material} x${provided}`);
        }
        if (needed > 0) {
            neededList.push(`${material} x${needed}`);
        }
    }

    const embed = requestHeader(interaction, 'Request Submitted', `✅ Requested **${data.requestName}** for **${data.character}**.`);
    embed.addFields(
        { name: 'Character', value: data.character, inline: true },
        { name: 'Profession', value: data.profession, inline: true },
        { name: 'Gear Slot', value: data.gearSlot, inline: true },
        { name: 'Item', value: data.requestName, inline: false },
        { name: '✅ You\'re Providing', value: providedList.length > 0 ? providedList.join('\n') : 'None', inline: true },
        { name: '❌ Still Needed', value: neededList.length > 0 ? neededList.join('\n') : 'All materials provided!', inline: true },
    );
    embed.setFooter({ text: '\u200B' }); // Add spacing for future images

    // Handle both interaction types for final message
    if (interaction.isModalSubmit()) {
        // Modal submissions need to respond to the message context
        // Find the original message in the channel and update it
        await interaction.deferUpdate();
        
        // Get the channel where the flow is happening
        const channel = interaction.channel;
        const messages = await channel.messages.fetch({ limit: config.recentMessageSearchLimit });
        const flowMessage = messages.find(msg => 
            msg.embeds.length > 0 && 
            msg.embeds[0].title === 'New Request'
        );
        
        if (flowMessage) {
            await flowMessage.edit({
                embeds: [embed],
                components: []
            });
        } else {
            // Fallback: send new message
            const msg = await channel.send({
                embeds: [embed]
            });
        }
    } else {
        await interaction.update({
            embeds: [embed],
            components: []
        });
    }

    // ** CLEAR: Flow complete, clear user activity tracking **
    cleanupService.clearUserActivity(interaction.user.id);
    
    // Final cleanup with completion timeout (COMPLETION = data state changed)
    if (config.requestMode === 'channel') {
        const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.COMPLETION);
        cleanupService.scheduleChannelDeletion(interaction.channel, timeout);
    } else if (config.requestMode === 'dm') {
        const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.COMPLETION);
        cleanupService.scheduleDMCleanup(interaction.channel, client, timeout, interaction.user.id);
    }
}

/**
 * Handles material buttons - either show modal for quantities or finalize with none
 */
async function handleMaterialsButton(interaction, client) {
    const customId = interaction.customId;
    
    // If user needs all materials (providing none)
    if (customId.startsWith('provide_mats_none')) {
        await finalizeRequest(interaction, client, {});
        return;
    }
    
    // If user wants to provide materials
    if (customId.startsWith('provide_mats_some')) {
        const key = customId.split('_').slice(3).join('_');
        const data = await getTempSession(key);
        
        if (!data) {
            const embed = requestHeader(interaction, 'New Request', '⚠️ Session expired. Please start over.');
            return interaction.update({
                embeds: [embed],
                components: []
            });
        }
        
        // Check if user has Core role
        const userId = interaction.user.id;
        const guild = client.guilds.cache.get(config.guildId);
        const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
        const hasCoreRole = member && config.coreRoleId && member.roles.cache.has(config.coreRoleId);
        
        // NON-CORE USERS: Auto-submit with full materials (no modal)
        if (!hasCoreRole) {
            // Build providedMaterials object with all required amounts
            const providedMaterials = {};
            for (const [material, required] of Object.entries(data.materials)) {
                providedMaterials[material] = required;
            }
            
            // Submit request immediately
            await finalizeRequest(interaction, client, providedMaterials);
            return;
        }
        
        // CORE USERS: Show modal to choose quantities
        // Store Core permission flag in session for validation
        await storeTempSession(key, userId, {
            ...data,
            hasCoreRole: true
        });
        
        // Show modal for first 5 materials
        await showMaterialModal(interaction, key, data, 1);
    }
}

/**
 * Shows modal for material quantity input
 * @param {*} interaction 
 * @param {string} key - Session key
 * @param {*} data - Session data
 * @param {number} modalNumber - 1 or 2 (for overflow)
 */
async function showMaterialModal(interaction, key, data, modalNumber) {
    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
    
    const materials = Object.entries(data.materials);
    const startIdx = (modalNumber - 1) * 5;
    const endIdx = Math.min(startIdx + 5, materials.length);
    const materialsSlice = materials.slice(startIdx, endIdx);
    
    const modal = new ModalBuilder()
        .setCustomId(`materials_modal_${modalNumber}_${key}`)
        .setTitle(`Material Quantities (${modalNumber}/${Math.ceil(materials.length / 5)})`);
    
    // Check if user has Core role (from session)
    const hasCoreRole = data.hasCoreRole || false;
    
    // Add input for each material (max 5)
    for (const [material, required] of materialsSlice) {
        const input = new TextInputBuilder()
            .setCustomId(`mat_${material.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100)}`)
            .setLabel(`${material.substring(0, 45)}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(hasCoreRole ? `0 to ${required} (optional)` : `Required: ${required}`)
            .setRequired(!hasCoreRole)  // Required for non-Core users
            .setValue(hasCoreRole ? '0' : `${required}`);  // Pre-fill required amount for non-Core
        
        modal.addComponents(new ActionRowBuilder().addComponents(input));
    }
    
    await interaction.showModal(modal);
}

/**
 * Handles modal submission for material quantities
 */
async function handleMaterialsModal(interaction, client) {
    const customId = interaction.customId;
    const parts = customId.split('_');
    const modalNumber = parseInt(parts[2]);
    const key = parts.slice(3).join('_');
    
    const data = await getTempSession(key);
    if (!data) {
        return interaction.reply({
            content: '⚠️ Session expired. Please start over with `/request`.',
            flags: MessageFlags.Ephemeral
        });
    }
    
    const materials = Object.entries(data.materials);
    const totalModals = Math.ceil(materials.length / 5);
    const startIdx = (modalNumber - 1) * 5;
    const endIdx = Math.min(startIdx + 5, materials.length);
    const materialsSlice = materials.slice(startIdx, endIdx);
    
    // Extract quantities from this modal
    const providedMaterials = data.providedMaterials || {};
    const hasCoreRole = data.hasCoreRole || false;
    
    // Validate material quantities
    for (const [material, required] of materialsSlice) {
        const fieldId = `mat_${material.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 100)}`;
        try {
            const valueStr = interaction.fields.getTextInputValue(fieldId) || '0';
            const value = parseInt(valueStr);
            
            // Non-Core users MUST provide exactly the required amount
            if (!hasCoreRole && value !== required) {
                return interaction.reply({
                    content: `❌ You must provide exactly **${required}** ${material}. Please try again.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            
            // Core users can provide 0 to required amount
            const clamped = Math.min(Math.max(0, isNaN(value) ? 0 : value), required);
            providedMaterials[material] = clamped;
        } catch (err) {
            log.warn(`[MATERIALS_MODAL] Failed to get value for ${fieldId}: ${err.message}`);
            // Non-Core users must provide required amount even on error
            providedMaterials[material] = hasCoreRole ? 0 : required;
        }
    }
    
    // Update session with partial data
    await storeTempSession(key, interaction.user.id, {
        ...data,
        providedMaterials
    });
    
    // If there are more materials, show next modal
    if (modalNumber < totalModals) {
        await interaction.deferUpdate();
        
        // Retrieve updated session data
        const updatedData = await getTempSession(key);
        await showMaterialModal(interaction, key, updatedData, modalNumber + 1);
    } else {
        // All modals completed - finalize request
        await finalizeRequest(interaction, client, providedMaterials);
    }
}

module.exports = {
  handleRequestFlow,
  handleRequestDropdowns,
  handleMaterialsButton,
  handleMaterialsModal,
};

