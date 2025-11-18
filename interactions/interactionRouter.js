const config = require('../config/config.js');
const log = require('../utils/logWriter');
const { recordUserActivity } = require('../utils/cleanupService');

const { handleRequestDropdowns, handleMaterialsButton, handleMaterialsModal } = require('./shared/requestFlow');
const { handleStatusCommand, handleStatusButton, handleStatusDropdown } = require('./shared/statusFlow');
const { handleRequestsOverview } = require('./shared/requestsFlow');
const { 
    handleCharacterManagement, 
    handleCharacterButtons,
    handleCharacterModal,
    handleCharacterDropdowns
} = require('./shared/characterFlow');
const { 
    handleManageRequestsMain,
    handleViewMyWork,
    handleClaimRequest,
    handleClaimDropdown,
    handleMarkComplete,
    handleCompleteDropdown,
    handleCompleteMulti,
    handleCompleteSingle,
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
} = require('./shared/manageCraftsFlow');
const {
    handleAdminSummary,
    handleAdminByProfession,
    handleAdminProfessionDropdown,
    handleAdminByCrafter,
    handleAdminCrafterDropdown,
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
    handleAdminProfessionPage
} = require('./shared/adminCraftsFlow');

async function handleInteractions(interaction, client) {
  // Determine type for logging
  const type = interaction.isChatInputCommand()
    ? 'command'
    : interaction.isButton()
    ? 'button'
    : interaction.isStringSelectMenu()
    ? 'dropdown'
    : interaction.isModalSubmit()
    ? 'modal'
    : 'other';
  const id = interaction.customId || '(none)';
  const user = interaction.user?.tag || 'unknown-user';

  log.debug(`[INTERACT] type=${type} id=${id} user=${user}`);

  try {
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('char_')) {
        await handleCharacterDropdowns(interaction, client);
      } else if (interaction.customId.startsWith('status_')) {
        await handleStatusDropdown(interaction, client);
      } else if (interaction.customId.startsWith('manage_crafts:')) {
        // Manage crafts dropdowns
        switch (interaction.customId) {
          case 'manage_crafts:claim_dropdown':
            await handleClaimDropdown(interaction, client);
            break;
          case 'manage_crafts:complete_dropdown':
            await handleCompleteDropdown(interaction, client);
            break;
          case 'manage_crafts:release_dropdown':
            await handleReleaseDropdown(interaction, client);
            break;
          case 'manage_crafts:admin_profession_dropdown':
            await handleAdminProfessionDropdown(interaction, client);
            break;
          case 'manage_crafts:admin_crafter_dropdown':
            await handleAdminCrafterDropdown(interaction, client);
            break;
          default:
            // Handle admin reassign dropdown
            if (interaction.customId.startsWith('manage_crafts:admin_reassign_select_')) {
              const requestId = parseInt(interaction.customId.split('_').pop());
              await handleAdminReassignSelect(interaction, client, requestId);
              break;
            }
            log.warn(`Unrecognized manage_crafts dropdown: ${interaction.customId}`);
        }
      } else {
        await handleRequestDropdowns(interaction, client);
      }

    } else if (interaction.isButton()) {
      // Button clicks
      if (interaction.customId.startsWith('provide_mats_')) {
        await handleMaterialsButton(interaction, client);
        return;
      }
      
      // Manage crafts buttons
      if (interaction.customId.startsWith('manage_crafts:')) {
        switch (interaction.customId) {
          case 'action_manage_requests':
          case 'manage_crafts:main':
            await handleManageRequestsMain(interaction, client);
            break;
          case 'manage_crafts:view_my_work':
            await handleViewMyWork(interaction, client);
            break;
          case 'manage_crafts:claim_request':
            await handleClaimRequest(interaction, client);
            break;
          case 'manage_crafts:mark_complete':
            await handleMarkComplete(interaction, client);
            break;
          case 'manage_crafts:release_request':
            await handleReleaseRequest(interaction, client);
            break;
          case 'manage_crafts:material_lists':
            await handleMaterialLists(interaction, client);
            break;
          case 'manage_crafts:materials_master':
            await handleMaterialsMaster(interaction, client);
            break;
          case 'manage_crafts:materials_per_char':
            await handleMaterialsPerChar(interaction, client);
            break;
          case 'manage_crafts:back_to_menu':
            await handleBackToMenu(interaction, client);
            break;
          case 'manage_crafts:change_profession':
            await handleChangeProfession(interaction, client);
            break;
          case 'manage_crafts:switch_to_crafter':
            await handleSwitchToCrafter(interaction, client);
            break;
          case 'manage_crafts:switch_to_admin':
            await handleSwitchToAdmin(interaction, client);
            break;
          case 'manage_crafts:admin_summary':
            await handleAdminSummary(interaction, client, 0);
            break;
          case 'manage_crafts:admin_by_profession':
            await handleAdminByProfession(interaction, client);
            break;
          case 'manage_crafts:admin_by_crafter':
            await handleAdminByCrafter(interaction, client);
            break;
          case 'manage_crafts:admin_lookup':
            await handleAdminLookup(interaction, client);
            break;
          case 'manage_crafts:admin_audit':
            await handleAdminAudit(interaction, client);
            break;
          case 'manage_crafts:audit_search':
            await handleAdminAuditSearch(interaction, client);
            break;
          case 'manage_crafts:back_to_admin_menu':
            await handleBackToAdminMenu(interaction, client);
            break;
          default:
            // Handle pagination for admin summary
            if (interaction.customId.startsWith('manage_crafts:admin_summary_page_')) {
              await handleAdminSummaryPage(interaction, client);
              break;
            }
            // Handle pagination buttons for audit log
            if (interaction.customId.startsWith('manage_crafts:audit_page_')) {
              const page = parseInt(interaction.customId.replace('manage_crafts:audit_page_', ''));
              await handleAdminAuditPage(interaction, client, page);
              break;
            }
            // Handle pagination buttons for audit search results
            if (interaction.customId.startsWith('manage_crafts:audit_search_page_')) {
              const remainder = interaction.customId.replace('manage_crafts:audit_search_page_', '');
              const lastUnderscore = remainder.lastIndexOf('_');
              const characterName = remainder.substring(0, lastUnderscore);
              const page = parseInt(remainder.substring(lastUnderscore + 1));
              await handleAdminAuditSearchPage(interaction, client, characterName, page);
              break;
            }
            // Handle pagination buttons for admin profession queue
            if (interaction.customId.startsWith('manage_crafts:admin_prof_page_')) {
              const parts = interaction.customId.replace('manage_crafts:admin_prof_page_', '').split('_');
              const page = parseInt(parts.pop());
              const profession = parts.join('_');
              await handleAdminProfessionPage(interaction, client, profession, page);
              break;
            }
            // Handle pagination for crafter queue
            if (interaction.customId.startsWith('manage_crafts:admin_crafter_page_')) {
              await handleAdminCrafterPage(interaction, client);
              break;
            }
            
            // Handle admin request management buttons
            if (interaction.customId.startsWith('manage_crafts:admin_reassign_')) {
              const requestId = parseInt(interaction.customId.split('_').pop());
              await handleAdminReassign(interaction, client, requestId);
              break;
            }
            
            if (interaction.customId.startsWith('manage_crafts:admin_cancel_')) {
              const requestId = parseInt(interaction.customId.split('_').pop());
              await handleAdminCancel(interaction, client, requestId);
              break;
            }
            
            if (interaction.customId.startsWith('manage_crafts:admin_mark_complete_')) {
              const requestId = parseInt(interaction.customId.split('_').pop());
              await handleAdminMarkComplete(interaction, client, requestId);
              break;
            }
            
            if (interaction.customId.startsWith('manage_crafts:admin_reopen_')) {
              const requestId = parseInt(interaction.customId.split('_').pop());
              await handleAdminReopen(interaction, client, requestId);
              break;
            }
            
            // Handle dynamic button IDs
            if (interaction.customId.startsWith('manage_crafts:complete_multi:')) {
              await handleCompleteMulti(interaction, client);
            } else if (interaction.customId.startsWith('manage_crafts:complete_single:')) {
              await handleCompleteSingle(interaction, client);
            } else if (interaction.customId.startsWith('manage_crafts:select_profession:')) {
              await handleSelectProfession(interaction, client);
            } else {
              log.warn(`Unrecognized manage_crafts button: ${interaction.customId}`);
            }
        }
        return;
      }
      
      switch (interaction.customId) {
        case 'action_request':
          await client.commands.get('request').execute(interaction, client);
          break;
        case 'action_status':
          await handleStatusCommand(interaction, client, true); // Pass true since it's a button
          break;
        case 'action_allrequests':
          await handleRequestsOverview(interaction, client);
          break;
        case 'action_manage_characters':
          await handleCharacterManagement(interaction, client);
          break;
        case 'action_manage_requests':
          await handleManageRequestsMain(interaction, client);
          break;
        default:
          // Delegate to other flows if the ID matches a pattern
          if (interaction.customId.startsWith('char_')) {
            await handleCharacterButtons(interaction, client);
          } else if (interaction.customId.startsWith('status_')) {
            await handleStatusButton(interaction, client);
          } else {
            log.warn(`Unrecognized button ID: ${interaction.customId}`);
          }
      }
    } else if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('char_')) {
            await handleCharacterModal(interaction, client);
        } else if (interaction.customId.startsWith('materials_modal_')) {
          await handleMaterialsModal(interaction, client);
        } else if (interaction.customId.startsWith('quantity_modal_')) {
          // Quantity modal submission from request flow
          const { handleQuantityModal } = require('./shared/requestFlow');
          await handleQuantityModal(interaction, client);
        } else if (interaction.customId.startsWith('complete_modal_')) {
          // Completion modal (single/partial complete) handled by manageCraftsFlow
          const { handleCompleteModal } = require('./shared/manageCraftsFlow');
          await handleCompleteModal(interaction, client);
        } else if (interaction.customId === 'manage_crafts:admin_lookup_modal') {
            await handleAdminLookupModal(interaction, client);
        } else if (interaction.customId === 'manage_crafts:admin_audit_modal') {
            await handleAdminAuditModal(interaction, client);
        } else if (interaction.customId.startsWith('manage_crafts:admin_reassign_modal_')) {
            const requestId = parseInt(interaction.customId.split('_').pop());
            await handleAdminReassignModal(interaction, client, requestId);
        } else if (interaction.customId.startsWith('manage_crafts:admin_cancel_modal_')) {
            const requestId = parseInt(interaction.customId.split('_').pop());
            await handleAdminCancelModal(interaction, client, requestId);
        }
    }
  } catch (err) {
    log.error(`Error in interactionRouter for ${user}`, err);
    
    // Don't try to respond to expired interactions
    if (err.code === 10062) {
      log.debug('Interaction expired, but operation may have completed successfully');
      return;
    }
    
    const opts = { content: 'An error occurred.', flags: 1 << 6 };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(opts);
      } else {
        await interaction.reply(opts);
      }
    } catch (replyErr) {
      if (replyErr.code !== 10062) {
        log.error('Failed to send error message:', replyErr);
      }
    }
  }
}

module.exports = { handleInteractions };
