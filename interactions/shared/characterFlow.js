const { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    ChannelType
} = require('discord.js');
const db = require('../../utils/database');
const { hasRegisterRole } = require('../../utils/permissionChecks');

const { resolveResponseChannel } = require('../../utils/requestChannel');
const cleanupService = require('../../utils/cleanupService');
const { getNavigationMessage } = require('../../utils/navigationHelper');
const { ensureDMMenu } = require('../../utils/dmMenu');
const config = require('../../config/config');
const log = require('../../utils/logWriter');

/**
 * Helper to get guild member from interaction (works in both DM and guild contexts)
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').Client} client
 * @returns {Promise<import('discord.js').GuildMember|null>}
 */
async function getGuildMember(interaction, client) {
    // If in guild context, member is available
    if (interaction.member) {
        return interaction.member;
    }
    
    // In DM context, fetch member from guild
    try {
        const guild = await client.guilds.fetch(config.guildId);
        const member = await guild.members.fetch(interaction.user.id);
        return member;
    } catch (err) {
        log.error('[CHARACTER_FLOW] Failed to fetch guild member:', err);
        return null;
    }
}

/**
 * Displays the main character management menu.
 * Follows unified 4-step pattern:
 * 1. Resolve response channel
 * 2. Send menu to that channel
 * 3. Reply with navigation (ephemeral)
 * 4. Schedule cleanup if needed
 * 
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').Client} client
 */
async function handleCharacterManagement(interaction, client) {
  try {
    // STEP 1: Permission check - only users with register role can manage characters
    const userId = interaction.user.id;
    const member = await getGuildMember(interaction, client);
    
    if (!hasRegisterRole(member)) {
      await db.logAction(userId, 'characterManagement_denied', null, {
        reason: 'Missing required role',
        source: 'character_management_menu'
      });
      
      return interaction.reply({
        content: '❌ You do not have permission to manage characters.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // STEP 1b: Defer interaction immediately if it's a button to prevent timeout during cleanup
    if (!interaction.isChatInputCommand() && !interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
    
    // STEP 2: Resolve response channel (respects config.requestMode)
    const channel = await resolveResponseChannel(interaction, client);
    // NOTE: resolveResponseChannel already calls ensureDMMenu in DM mode, no need to call again
    
    // ** CLEANUP: Clear ALL messages (including admin/crafter menus) when opening character flow **
    // This can take time, but interaction is already deferred so it won't timeout
    cleanupService.trackUserChannel(userId, channel.id);
    await cleanupService.cleanupAllFlowMessages(userId, client);
    cleanupService.clearMenuHierarchy(userId);
    
    // Schedule cleanup if in channel mode
    if (config.requestMode === 'channel' && channel.type === ChannelType.GuildText) {
      cleanupService.scheduleChannelDeletion(channel);
    }

    // STEP 2: Build menu buttons
    const row = new ActionRowBuilder().addComponents(
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

    // STEP 3: Send menu to resolved channel (stays visible)
    const msg = await channel.send({
      content: '👤 **Character Management**\n\nSelect an option below to manage your registered characters.',
      components: [row],
    });
    
    // Track at Level 2 (main character menu - ANCHOR POINT)
    cleanupService.trackMenuMessage(userId, 2, msg.id);

    // STEP 4: Ephemeral navigation reply (only if interaction not already handled)
    if (!interaction.deferred && !interaction.replied) {
      const followUp = getNavigationMessage(interaction, channel);
      if (followUp) {
        await interaction.reply({
          content: followUp,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        // In DM, acknowledge differently based on interaction type
        if (interaction.isChatInputCommand()) {
          // Slash command - use reply
          await interaction.reply({
            content: '✅ Character management menu opened.',
            flags: MessageFlags.Ephemeral,
          });
        } else {
          // Button interaction - use deferUpdate
          await interaction.deferUpdate();
        }
      }
    }
  } catch (err) {
    log.error('[CHARACTER MANAGEMENT] Error:', err);
    await interaction.reply({
      content: '❌ An error occurred while opening Character Management.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handles button clicks within the character management flow.
 * Follows unified 4-step pattern:
 * 1. Preparation (defer, get data)
 * 2. Resolve response channel
 * 3. Send interactive content to resolved channel
 * 4. Reply to interaction with navigation
 * 
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {import('discord.js').Client} client
 */
async function handleCharacterButtons(interaction, client) {
    const { customId } = interaction;

    // STEP 1: Prepare for response
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // STEP 2: Resolve response channel (respects config.requestMode)
        const channel = await resolveResponseChannel(interaction, client);
        if (config.requestMode === 'channel' && channel.type === ChannelType.GuildText) {
            cleanupService.scheduleChannelDeletion(channel);
        }

        if (customId === 'char_register_start') {
            // Clean Level 3+ (keep character menu at Level 2)
            await cleanupService.cleanupFromLevel(interaction.user.id, client, 3);
            
            // STEP 3: Send interactive content to resolved channel
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('char_register_type_select')
                    .setPlaceholder('Select character type')
                    .addOptions([
                        { label: 'Main', value: 'main' },
                        { label: 'Alt', value: 'alt' },
                    ]),
            );

            const msg = await channel.send({
                content: 'Please select the type of character you want to register.',
                components: [row],
            });
            
            // Track at Level 3 (submenu dropdown)
            cleanupService.trackMenuMessage(interaction.user.id, 3, msg.id);

            // STEP 4: Reply to interaction with navigation (only if needed)
            const followUp = getNavigationMessage(interaction, channel);
            if (followUp) {
                await interaction.editReply({ content: followUp });
            } else {
                // In DM, just dismiss the loading state
                await interaction.deleteReply().catch(() => {});
            }

        } else if (customId === 'char_view') {
            // Clean Level 3+ (keep character menu at Level 2)
            await cleanupService.cleanupFromLevel(interaction.user.id, client, 3);
            
            // STEP 3: Send interactive content to resolved channel
            const characters = await db.getCharactersByUser(interaction.user.id);
            const charList = characters.length
                ? characters.map(c => `• **${c.name}** (${c.type})`).join('\n')
                : 'You have no characters registered.';

            const msg = await channel.send({
                content: `**Your Registered Characters:**\n${charList}\n\n_Use the Character Management buttons above to register new characters or delete existing ones._`,
                components: [], // No additional buttons - main menu buttons remain visible
            });
            
            // Track at Level 4 (output display)
            cleanupService.trackMenuMessage(interaction.user.id, 4, msg.id);

            // STEP 4: Reply to interaction with navigation (only if needed)
            const followUp = getNavigationMessage(interaction, channel);
            if (followUp) {
                await interaction.editReply({ content: followUp });
            } else {
                // In DM, just dismiss the loading state
                await interaction.deleteReply().catch(() => {});
            }

        } else if (customId === 'char_delete_start') {
            // Clean Level 3+ (keep character menu at Level 2)
            await cleanupService.cleanupFromLevel(interaction.user.id, client, 3);
            
            // STEP 3: Send interactive content to resolved channel
            const characters = await db.getCharactersByUser(interaction.user.id);
            if (!characters.length) {
                const msg = await channel.send({
                    content: 'You have no characters to delete.',
                });
                
                // Track at Level 4 (output message)
                cleanupService.trackMenuMessage(interaction.user.id, 4, msg.id);

                // STEP 4: Reply to interaction with navigation (only if needed)
                const followUp = getNavigationMessage(interaction, channel);
                if (followUp) {
                    return interaction.editReply({ content: followUp });
                } else {
                    // In DM, just dismiss the loading state
                    return interaction.deleteReply().catch(() => {});
                }
            }

            const options = characters.map(c => ({
                label: `${c.name} (${c.type})`,
                value: `char_delete_select_${c.id}`,
            }));

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('char_delete_menu')
                    .setPlaceholder('Select a character to delete')
                    .addOptions(options),
            );

            const msg = await channel.send({
                content: 'Select the character you wish to delete.',
                components: [row],
            });
            
            // Track at Level 3 (submenu dropdown)
            cleanupService.trackMenuMessage(interaction.user.id, 3, msg.id);

            // STEP 4: Reply to interaction with navigation (only if needed)
            const followUp = getNavigationMessage(interaction, channel);
            if (followUp) {
                await interaction.editReply({ content: followUp });
            } else {
                // In DM, just dismiss the loading state
                await interaction.deleteReply().catch(() => {});
            }
        }
    } catch (err) {
        log.error('[CHARACTER BUTTONS] Error:', err);
        const errorMsg = '❌ An error occurred while managing your characters.';
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: errorMsg });
        } else {
            await interaction.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
        }
    }
}

/**
 * Handles the submission of the character registration modal.
 * Modal itself is shown to user (Discord limitation).
 * Response to modal submission follows 4-step pattern:
 * 1. Show modal (handled by dropdown)
 * 2. Resolve response channel when modal submitted
 * 3. Send confirmation to resolved channel
 * 4. Reply to interaction with navigation
 * 
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {import('discord.js').Client} client
 */
async function handleCharacterModal(interaction, client) {
    if (interaction.customId.startsWith('char_register_name_modal_')) {
        try {
            const type = interaction.customId.split('_').pop();
            const name = interaction.fields.getTextInputValue('char_name');

            // STEP 1: Prepare response
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            // STEP 2: Resolve response channel (respects config.requestMode)
            const channel = await resolveResponseChannel(interaction, client);

            // Register character with the selected type (no restrictions on multiple mains)
            let confirmationContent = `✅ Successfully registered character: **${name}** (${type}).`;

            // Register character
            await db.registerCharacter(interaction.user.id, name, type);

            // Clean Level 3+ (keep character menu at Level 2)
            await cleanupService.cleanupFromLevel(interaction.user.id, client, 3);

            // STEP 3: Send confirmation to resolved channel
            const confirmMsg = await channel.send({
                content: confirmationContent,
            });
            
            // Track confirmation at Level 4 (output)
            cleanupService.trackMenuMessage(interaction.user.id, 4, confirmMsg.id);

            // STEP 4: Reply to interaction with navigation (only if needed)
            const followUp = getNavigationMessage(interaction, channel);
            if (followUp) {
                await interaction.editReply({ content: followUp });
            } else {
                // In DM, just dismiss the loading state
                await interaction.deleteReply().catch(() => {});
            }
            
            // Auto-cleanup confirmation after delay (Level 3+, keeps Level 2 menu visible)
            const timeout = cleanupService.getCleanupTimeout(cleanupService.MessageType.COMPLETION);
            setTimeout(async () => {
                await cleanupService.cleanupFromLevel(interaction.user.id, client, 3);
            }, timeout);

        } catch (err) {
            log.error('[CHARACTER MODAL] Error:', err);
            const errorMsg = '❌ An error occurred while registering your character.';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: errorMsg });
            } else {
                await interaction.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
            }
        }
    }
}

/**
 * Handles the selection from character management dropdowns.
 * State machine for the character registration and deletion flows.
 * 
 * For registration: Shows modal, which then calls handleCharacterModal.
 * For deletion: Uses interaction.update() to prevent message spam.
 * 
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {import('discord.js').Client} client
 */
async function handleCharacterDropdowns(interaction, client) {
    const { customId, values } = interaction;

    try {
        if (customId === 'char_register_type_select') {
            // Permission already checked at menu level - no need to check again
            
            // REGISTRATION FLOW: Show modal (Discord limitation - modals go to user)
            const type = values[0];
            const modal = new ModalBuilder()
                .setCustomId(`char_register_name_modal_${type}`)
                .setTitle('Register New Character');

            const nameInput = new TextInputBuilder()
                .setCustomId('char_name')
                .setLabel("Character Name")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
            await interaction.showModal(modal);
            
        } else if (customId === 'char_delete_menu') {
            // DELETION FLOW: Delete character and return to main menu
            try {
                const characterId = parseInt(values[0].split('_').pop());
                const userId = interaction.user.id;
                
                const result = await db.deleteCharacter(userId, characterId);

                // Show success message with info about cancelled requests
                let message = '## ✅ Character Deleted Successfully\n\n';
                if (result.cancelledRequests > 0) {
                    const requestText = result.cancelledRequests === 1 ? 'request was' : 'requests were';
                    message += `**${result.cancelledRequests}** open or in-progress ${requestText} automatically cancelled.\n\n`;
                }
                message += '_Returning to character menu..._';

                await interaction.update({
                    content: message,
                    embeds: [],
                    components: [],
                });

                // Wait a moment for user to see confirmation
                await new Promise(resolve => setTimeout(resolve, config.characterConfirmationDelay));

                // Clean Level 3+ (dropdown and confirmation) - keeps Level 2 menu visible
                await cleanupService.cleanupFromLevel(userId, client, 3);
                
                // Level 2 menu still visible - no need to rebuild it

            } catch (err) {
                log.error('[CHARACTER DROPDOWN] Deletion error:', err);
                await interaction.update({
                    content: '❌ An error occurred while deleting the character.',
                    embeds: [],
                    components: [],
                });
            }
        }
    } catch (err) {
        log.error('[CHARACTER DROPDOWN] Error:', err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: '❌ An error occurred. Please try again.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
}

module.exports = {
  handleCharacterManagement,
  handleCharacterButtons,
  handleCharacterModal,
  handleCharacterDropdowns,
};