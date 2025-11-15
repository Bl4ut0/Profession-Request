# Profession Data Format Guide

**Last Updated**: November 14, 2025  
**Purpose**: Unified guide for all profession items (enchants, crafts, consumables, etc.)

---

## File Structure

All profession files go in `config/` directory:
- `config/enchanting.json` - Enchanting items
- `config/tailoring.json` - Tailoring items
- `config/alchemy.json` - Alchemy items (future)
- `config/blacksmithing.json` - Blacksmithing items (future)
- etc.

---

## JSON Format

### Top-Level Structure (UNIFIED)

```json
{
  "_comment": "Optional: Notes about WoW version or expansion",
  "_version": "Optional: Version identifier (e.g., Classic, TBC, Wrath, Cata)",
  "items": {
    "SlotOrCategory": [ ...item objects... ]
  }
}
```

**Note**: Legacy keys (`enchants`, `recipes`, `crafts`) are still supported for backward compatibility but **all new files should use `items`**.

### Item Object Structure

Works for **all professions**: enchants, crafts, consumables, etc.

```json
{
  "name": "Item Name - Description",
  "materials": [
    "Material Name xQuantity",
    "Another Material xQuantity"
  ]
}
```

**Examples**:
- Enchanting: `"Enchant Chest - Greater Stats"`
- Tailoring: `"Robe of the Void"`
- Alchemy: `"Flask of the Titans"` (future)
- Blacksmithing: `"Lionheart Helm"` (future)

---

## Material Format Options

The system supports **TWO formats** for backward compatibility:

### Format 1: String (Recommended - Easier to Read)

```json
"materials": [
  "Greater Eternal Essence x4",
  "Illusion Dust x10",
  "Nexus Crystal x2"
]
```

**Advantages**:
- ✅ Human-readable
- ✅ Easy to copy from WoW databases
- ✅ Compact

### Format 2: Object (Advanced)

```json
"materials": [
  { "name": "Greater Eternal Essence", "quantity": 4 },
  { "name": "Illusion Dust", "quantity": 10 },
  { "name": "Nexus Crystal", "quantity": 2 }
]
```

**Advantages**:
- ✅ Structured data
- ✅ Can add metadata (rarity, etc.) in future

**Both formats work!** The parser automatically converts them.

---

## Complete Examples

### Example 1: Enchanting (Equipment Slots)

```json
{
  "_comment": "Enchanting items for Classic WoW",
  "_version": "1.12",
  
  "items": {
    "Head": [],
    
    "Chest": [
      {
        "name": "Enchant Chest - Living Stats",
        "materials": [
          "Large Brilliant Shard x5",
          "Crimson Shard x10",
          "Soul Dust x2"
        ]
      },
      {
        "name": "Enchant Chest - Greater Stats",
        "materials": [
          "Large Brilliant Shard x4",
          "Crimson Shard x15",
          "Dream Dust x10"
        ]
      }
    ],
    
    "Weapon": [
      {
        "name": "Enchant Weapon - Crusader",
        "materials": [
          "Large Brilliant Shard x4",
          "Righteous Orb x2"
        ]
      }
    ]
  }
}
```

### Example 2: Tailoring (Equipment + Special Categories)

```json
{
  "_comment": "Tailoring items for Classic WoW",
  "_version": "1.12",
  
  "items": {
    "Chest": [
      {
        "name": "Robe of the Void",
        "materials": [
          "Felcloth x10",
          "Dark Rune x4",
          "Greater Eternal Essence x4"
        ]
      }
    ],
    
    "Bags": [
      {
        "name": "Mooncloth Bag",
        "materials": [
          "Mooncloth x4",
          "Rune Thread x1"
        ]
      }
    ],
    
    "Shirt": [
      {
        "name": "Tuxedo Shirt",
        "materials": [
          "Bolt of Mageweave x6",
          "Fine Thread x1"
        ]
      }
    ]
  }
}
```

### Example 3: Alchemy (Future - Consumable Category)

```json
{
  "_comment": "Alchemy consumables for Classic WoW",
  "_version": "1.12",
  
  "items": {
    "Consumable": [
      {
        "name": "Flask of the Titans",
        "materials": [
          "Stonescale Oil x30",
          "Black Lotus x1",
          "Crystal Vial x1"
        ]
      },
      {
        "name": "Greater Fire Protection Potion",
        "materials": [
          "Elemental Fire x1",
          "Firefin Snapper x1",
          "Crystal Vial x1"
        ]
      }
    ]
  }
}
```

---

## Slot/Category Names (Unified System)

**The system uses "slots" as a generic term for any category of items.**

### Equipment Slots (Enchanting, Tailoring, Blacksmithing, etc.)

```json
"Head", "Neck", "Shoulders", "Back", "Chest", "Wrist",
"Hands", "Waist", "Legs", "Feet",
"Ring", "Weapon", "2H Weapon", "Shield", "Off-Hand"
```

### Special Categories

```json
"Bags"          // Tailoring bags
"Shirt"         // Tailoring shirts/cosmetics
"Consumable"    // Alchemy potions/elixirs/flasks (future)
"Food"          // Cooking recipes (future)
"Gem"           // Jewelcrafting gems (future)
"Scope"         // Engineering scopes (future)
```

### How It Works

The system is **completely profession-agnostic**:
- **Enchanting**: Uses equipment slots (Chest, Weapon, etc.)
- **Tailoring**: Uses equipment slots + Bags + Shirt
- **Alchemy** (future): Would use "Consumable" category
- **Cooking** (future): Would use "Food" category

The identifier format is: `profession.slot.itemName`
- Example: `enchanting.Chest.Greater Stats`
- Example: `tailoring.Bags.Mooncloth Bag`
- Example: `alchemy.Consumable.Flask of the Titans` (future)

**Note**: Slots/categories must be enabled in `config.enabledGearSlots` in `config.js`

---

## Adding New Enchants

### Step 1: Find the correct slot

```json
"Chest": [
  // Add new enchant here
]
```

### Step 2: Add enchant object

```json
{
  "name": "Enchant Chest - Super Stats",
  "materials": [
    "Hypnotic Dust x20",
    "Greater Celestial Essence x10",
    "Heavenly Shard x5"
  ]
}
```

### Step 3: Test

Start the bot and use `/request` to verify the enchant appears.

---

## Updating for New WoW Expansions

### Scenario: Moving from Wrath to Cataclysm

1. **Backup current file**:
   ```
   cp config/enchanting.json config/enchanting-wrath-backup.json
   ```

2. **Update materials** (new expansion = new materials):
   ```json
   // OLD (Wrath)
   "materials": [
     "Greater Eternal Essence x4",
     "Illusion Dust x10"
   ]
   
   // NEW (Cata)
   "materials": [
     "Hypnotic Dust x20",
     "Greater Celestial Essence x10"
   ]
   ```

3. **Update enchant names** if changed:
   ```json
   // OLD
   "name": "Enchant Chest - Living Stats"
   
   // NEW
   "name": "Enchant Chest - Mighty Stats"
   ```

4. **Add new slots** if applicable:
   ```json
   "Ranged": [
     {
       "name": "Enchant Ranged - Scope",
       "materials": ["..."]
     }
   ]
   ```

5. **Remove outdated enchants** (optional):
   - You can leave old enchants for reference
   - Or delete them to keep the file clean

---

## Material Name Guidelines

### Be Consistent

✅ **Good**:
```json
"Greater Eternal Essence x4"
"Greater Eternal Essence x10"
```

❌ **Bad**:
```json
"Greater Eternal Essence x4"
"greater eternal essence x10"  // lowercase
"Gr. Eternal Ess. x10"          // abbreviated
```

### Use Full Item Names

✅ **Good**: `"Large Prismatic Shard x6"`  
❌ **Bad**: `"LPS x6"` (unclear abbreviation)

### Include Quantity

✅ **Good**: `"Illusion Dust x10"`  
❌ **Bad**: `"Illusion Dust"` (missing quantity)

---

## Common Materials by Expansion

### Classic
- Soul Dust
- Vision Dust
- Dream Dust
- Lesser/Greater/Superior Essence
- Small/Large/Greater Brilliant Shard
- Nexus Crystal

### TBC (Burning Crusade)
- Arcane Dust
- Lesser/Greater Planar Essence
- Small/Large Prismatic Shard
- Void Crystal
- Primal Nether, Primal Air, Primal Earth, etc.

### Wrath
- Infinite Dust
- Lesser/Greater Cosmic Essence
- Small/Large Dream Shard
- Abyss Crystal

### Cataclysm
- Hypnotic Dust
- Lesser/Greater Celestial Essence
- Small/Large Heavenly Shard
- Maelstrom Crystal

---

## Validation

### Before Committing Changes:

1. **JSON Syntax**: Use [JSONLint](https://jsonlint.com/) to validate
2. **Test in Bot**: Run `/request` and verify enchants appear
3. **Test Materials**: Submit a request and check material modal shows correctly
4. **Check Quantities**: Verify quantities are parsed correctly

### Quick Test:
```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('config/enchanting.json')))"
```

If no errors, JSON is valid!

---

## Troubleshooting

### Issue: Enchants not showing up

**Check**:
1. Slot name matches `config.enabledGearSlots` in `config.js`
2. JSON syntax is valid (no trailing commas, missing brackets)
3. Materials array is not empty

### Issue: Materials showing as "0 1" or garbled

**Check**:
1. Format is `"Material Name xQuantity"` (note the space before `x`)
2. Quantity is a valid integer
3. No typos in material names

### Issue: Modal won't open for materials

**Check**:
1. Maximum 10 materials per enchant (2 modals × 5 fields)
2. Material names are less than 100 characters
3. No special characters breaking the modal

---

## Future Enhancements

Planned features for profession data:

- [ ] Multi-profession support (Alchemy, Blacksmithing, etc.)
- [ ] Material rarity metadata (Common, Uncommon, Rare, Epic)
- [ ] Reagent vendor information
- [ ] Craft time estimates
- [ ] Skill level requirements
- [ ] Soulbound vs tradeable flags

---

## Quick Reference

**Add new enchant**:
```json
{
  "name": "Enchant Slot - Description",
  "materials": ["Material x#", "Material x#"]
}
```

**Empty slot** (no enchants available):
```json
"Head": []
```

**Multiple materials**:
```json
"materials": [
  "Dust x20",
  "Essence x10",
  "Shard x5",
  "Crystal x2"
]
```

---

**Need help?** Check `docs/INDEX.md` for full documentation.
