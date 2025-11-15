# Material Quantity Flow Implementation

**Date**: November 13, 2025  
**Status**: ✅ IMPLEMENTED - Ready for Testing  
**Priority**: HIGH

---

## Summary

Implemented comprehensive material quantity tracking system with modal-based input supporting up to 10 materials per recipe (2 modals of 5 each).

---

## Changes Made

### 1. Fixed Character Management Ephemeral Leak ✅

**File**: `interactions/shared/characterFlow.js`

**Problem**: When clicking "Manage Characters" button from #requests channel, it showed an ephemeral message in that channel instead of following the unified flow pattern.

**Solution**: Updated `handleCharacterManagement()` to follow the 4-step pattern:
1. Resolve response channel (DM or temp channel)
2. Send menu to that channel
3. Reply with ephemeral navigation
4. Schedule cleanup

**Additional Fix**: Removed guild context checks that were blocking DM functionality

**Before**:
```javascript
await interaction.reply({
  content: '👤 Character Management...',
  flags: MessageFlags.Ephemeral, // ❌ Shows in requests channel
});
```

**After**:
```javascript
const channel = await resolveResponseChannel(interaction, client);
await channel.send({ content: '👤 Character Management...', components: [row] });
await interaction.reply({
  content: '✅ Check your DM / Go to <#channel>',
  flags: MessageFlags.Ephemeral // ✅ Only navigation is ephemeral
});
```

---

### 2. Material Quantity Input System ✅

**File**: `interactions/shared/requestFlow.js`

#### Changes to Material Buttons

**Before**:
```javascript
[Yes, I have them] [No, I need them]
// Only saves boolean flag
```

**After**:
```javascript
[I have some materials] [I need all materials]
// "Some" → Opens modal for quantities
// "All" → Saves with empty provided_materials_json
```

#### New Functions Added

1. **`showMaterialModal(interaction, key, data, modalNumber)`**
   - Shows modal with 5 material quantity inputs
   - Supports modal 1 (items 1-5) or modal 2 (items 6-10)
   - Each input shows: material name, placeholder "0 to X (need X)"
   - Pre-filled with "0" for easy editing

2. **`handleMaterialsModal(interaction, client)`**
   - Processes modal submission
   - Validates and clamps quantities (0 to required)
   - Stores in session: `providedMaterials: { "Soul Dust": 5, ... }`
   - If more materials exist → shows next modal
   - If all modals done → finalizes request

3. **Updated `finalizeRequest(interaction, client, providedMaterialsObj)`**
   - Now accepts object: `{ "Soul Dust": 5, "Lesser Essence": 0 }`
   - Saves to `provided_materials_json` column
   - Builds detailed confirmation showing:
     - ✅ You're Providing: Soul Dust x5, Eternal Essence x2
     - ❌ Still Needed: Lesser Essence x3, Arcane Dust x10
   - Handles both button interactions and modal submissions

#### Modal Flow Example

**Recipe with 7 materials**:
```
1. User selects enchant
2. Bot shows material list + buttons
3. User clicks "I have some materials"
4. Modal 1 appears (materials 1-5)
5. User enters quantities → Submit
6. Modal 2 appears (materials 6-7)
7. User enters quantities → Submit
8. Request finalized with all quantities saved
```

---

### 3. Database Schema Update ✅

**File**: `utils/database.js`

#### Added Column

```sql
ALTER TABLE requests ADD COLUMN provided_materials_json TEXT;
```

**Stores**:
```json
{
  "Soul Dust": 5,
  "Lesser Eternal Essence": 0,
  "Arcane Dust": 10
}
```

#### Migration

Added automatic migration that:
1. Checks if `provided_materials_json` column exists
2. If not, adds it via `ALTER TABLE`
3. Logs success/failure
4. Non-destructive (existing data preserved)

#### Updated `addRequest()` Function

**Before**:
```javascript
function addRequest({ ..., materials_json, provides_materials })
```

**After**:
```javascript
function addRequest({ ..., materials_json, provided_materials_json, provides_materials })
```

Now accepts and stores the detailed material quantities.

---

### 4. Interaction Router Updates ✅

**File**: `interactions/interactionRouter.js`

#### Added Modal Handler

```javascript
else if (interaction.isModalSubmit()) {
  if (interaction.customId.startsWith('char_')) {
    await handleCharacterModal(interaction, client);
  } else if (interaction.customId.startsWith('materials_modal_')) {
    await handleMaterialsModal(interaction, client); // NEW
  }
}
```

#### Imported New Function

```javascript
const { 
  handleRequestDropdowns, 
  handleMaterialsButton, 
  handleMaterialsModal // NEW
} = require('./shared/requestFlow');
```

---

## Technical Details

### Modal Constraints

**Discord Limitations**:
- Max 5 `TextInput` components per modal
- Max 100 characters for custom IDs
- Max 45 characters for labels

**Our Solution**:
- Split materials into chunks of 5
- Show multiple modals sequentially
- Material names sanitized: `mat_Soul_Dust` (removes special chars)
- Truncate to 100 chars for safety

### Session Management

Materials are stored in temp_sessions during the flow:

```javascript
{
  character: "Aragorn",
  profession: "enchanting",
  gearSlot: "Weapon",
  requestId: "Mongoose",
  requestName: "Mongoose Enchant",
  materials: { "Soul Dust": 10, "Lesser Essence": 5 },
  providedMaterials: { "Soul Dust": 5, "Lesser Essence": 0 } // NEW
}
```

### Validation

- Quantities clamped: `Math.min(Math.max(0, value), required)`
- Invalid inputs default to 0
- NaN values handled gracefully
- Empty inputs treated as 0

---

## User Experience Flow

### Complete Request Flow (With Materials)

```
1. /request command
   ↓
2. Select character
   ↓
3. Select profession
   ↓
4. Select gear slot
   ↓
5. Select item/enchant
   ↓
6. View required materials
   ↓
7. Choose: [I have some] or [I need all]
   ↓
   7a. If "some": Modal 1 appears (5 materials)
       → Enter quantities → Submit
       → If more materials: Modal 2 appears (remaining)
       → Enter quantities → Submit
   ↓
   7b. If "all": Skip modals
   ↓
8. Confirmation embed shows:
   ✅ You're Providing: [list]
   ❌ Still Needed: [list]
   ↓
9. Cleanup scheduled
```

### Example Confirmation

```
✅ Requested Mongoose Enchant for Aragorn

Character: Aragorn
Profession: Enchanting
Gear Slot: Weapon
Item: Mongoose Enchant

✅ You're Providing:
Soul Dust x5
Eternal Essence x2

❌ Still Needed:
Lesser Essence x3
Arcane Dust x10
Primal Water x1
```

---

## Configuration Compatibility

### Works in Both Modes

✅ **DM Mode** (`config.requestMode = 'dm'`):
- All modals work in DMs
- Materials flow sent to DM
- Confirmation in DM
- Auto-cleanup after TTL

✅ **Channel Mode** (`config.requestMode = 'channel'`):
- Modals shown to user (Discord limitation)
- Materials flow in temp channel
- Confirmation in temp channel
- Channel deleted after TTL

---

## Testing Checklist

### Test Cases

- [ ] **Request with 0 materials** (should skip material input)
- [ ] **Request with 1-5 materials** (single modal)
- [ ] **Request with 6-10 materials** (two modals)
- [ ] **User provides 0 of all materials** (same as "need all")
- [ ] **User provides partial quantities** (e.g., 5 out of 10)
- [ ] **User provides all materials** (100% fulfillment)
- [ ] **Invalid input handling** (letters, decimals, negatives)
- [ ] **Modal cancellation** (user closes without submitting)
- [ ] **Session expiry** (24 hour timeout)
- [ ] **DM mode** (all flows work)
- [ ] **Channel mode** (all flows work)
- [ ] **Duplicate request prevention** (5 second window)

### Commands to Test

```bash
# Test request flow
/request
# → Select character → profession → slot → item
# → Choose materials option
# → Submit quantities

# Test character management (ephemeral fix)
Click "Manage Characters" button in #requests
# → Should open in DM or temp channel
# → Should NOT show ephemeral in #requests

# Test status command
/status
# → Should show in DM or temp channel

# Test requests overview
/requests
# → Should show in DM or temp channel
```

---

## Database Query Examples

### View Provided Materials

```sql
-- See what materials users are providing
SELECT 
  id,
  character,
  request_name,
  provided_materials_json,
  provides_materials
FROM requests
WHERE provides_materials = 1;
```

### Calculate Material Needs

```sql
-- Find requests needing specific materials
SELECT 
  character,
  request_name,
  materials_json,
  provided_materials_json
FROM requests
WHERE status = 'open'
  AND profession = 'enchanting';
```

---

## Future Enhancements (Phase 2)

### Crafter System

**Claim Flow** (To be implemented):
```javascript
// When crafter claims a request
const request = await db.getRequestById(requestId);
const required = JSON.parse(request.materials_json);
const provided = JSON.parse(request.provided_materials_json || '{}');

// Calculate what's still needed
const needed = {};
for (const [mat, reqQty] of Object.entries(required)) {
  const provQty = provided[mat] || 0;
  const needQty = reqQty - provQty;
  if (needQty > 0) {
    needed[mat] = needQty;
  }
}

// Show crafter the breakdown
embed.addFields(
  { name: 'Player Providing', value: formatMaterials(provided) },
  { name: 'You Need', value: formatMaterials(needed) }
);
```

**Status Updates**:
- Crafters can mark as "in_progress", "complete", "denied"
- Admins can reassign to different crafter
- Material tracking persists through status changes

**Material Dashboard**:
- Show aggregate needs per profession
- "We need 50x Soul Dust across all enchanting requests"
- Filter by player-provided vs guild-provided

---

## Files Modified

1. ✅ `interactions/shared/characterFlow.js` - Fixed ephemeral leak + removed guild checks
2. ✅ `interactions/shared/requestFlow.js` - Added material quantity system
3. ✅ `interactions/interactionRouter.js` - Added modal routing
4. ✅ `utils/database.js` - Added column + migration
5. ✅ `utils/requestChannel.js` - Added DM cleanup before sending
6. ✅ `utils/cleanupService.js` - Improved DM message cleanup

## Files Created

1. ✅ `docs/13-MATERIAL_FLOW_IMPLEMENTATION.md` - This document

---

## Risk Assessment

**Risk Level**: 🟢 LOW

- All changes follow existing patterns
- Database migration is non-destructive
- Backward compatible (old requests still work)
- No breaking changes to existing flows
- Thorough validation and error handling

---

## Rollback Plan

If issues arise:

1. **Database**: Column addition is safe (nullable)
2. **Code**: Revert 4 files via git
3. **Data**: Existing requests unaffected
4. **Users**: Can still submit requests (with boolean flag)

---

## Next Steps

1. **Test in development environment**
   - Both DM and channel modes
   - All material quantity scenarios
   - Edge cases and error handling

2. **Verify database migration**
   - Check column added successfully
   - Confirm data persists correctly
   - Test queries work as expected

3. **User acceptance testing**
   - Have guild members test flows
   - Gather feedback on UX
   - Adjust labels/messages if needed

4. **Phase 2 planning**
   - Design crafter claim system
   - Implement material dashboard
   - Add admin management tools

---

## Questions Answered

✅ **Do recipes have more than 5 materials?**  
Yes, up to 10. Implemented 2-modal overflow system.

✅ **Should users provide partial quantities?**  
Yes. Users can provide 0 to max of each material.

✅ **Should crafters see provided materials?**  
Yes. Stored in `provided_materials_json` for crafter view (Phase 2).

✅ **Character management ephemeral issue?**  
Fixed. Now follows unified 4-step pattern.

---

**Implementation Complete** ✅  
Ready for testing and deployment.
