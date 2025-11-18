# How to Change and Format the `primaryMenuMessage`

The `primaryMenuMessage` in your `config.js` controls the main menu message shown to users. You can use Discord's Markdown formatting to customize its appearance.

## How to Change the Message

1. Open `config/config.js` in your editor.
2. Find the section:
   ```js
   // PRIMARY MENU MESSAGE CONFIGURATION
   primaryMenuMessage: `...`,
   ```
3. Edit the text inside the backticks (`` ` ``) to change the message. Save the file and restart your bot to apply changes.

## Discord Markdown Formatting Reference

You can use the following Markdown styles in your message:

| Style         | Syntax Example                  | Renders As                |
|---------------|-------------------------------|---------------------------|
| **Bold**      | `**bold text**`                | **bold text**             |
| *Italic*      | `*italic text*` or `_italic_`  | *italic text*             |
| __Underline__ | `__underline__`                | __underline__             |
| ~~Strikethrough~~ | `~~strike~~`               | ~~strike~~                |
| `Inline code` | `` `inline code` ``            | `inline code`             |
| > Blockquote  | `> quoted text`                | > quoted text             |
| # Heading 1   | `# Heading`                    | # Heading                 |
| ## Heading 2  | `## Heading`                   | ## Heading                |
| ### Heading 3 | `### Heading`                  | ### Heading               |
| New line      | `\n` (in config string)        | (line break)              |

### Example
```js
primaryMenuMessage: `# **Welcome!**\n\nUse the **buttons** below.\n• **/request** — Start a new request.\n> _Tip: You can use markdown!_`
```

## Tips
- Use double asterisks `**` for bold, single asterisks `*` or underscores `_` for italics.
- Use `\n` for new lines inside the config string.
- You can combine styles, e.g., `__**bold and underlined**__`.
- Discord does not support all Markdown features (no tables, no images).
- Always keep the message inside backticks (`` ` ``) in `config.js`.

---

For more, see [Discord Markdown Guide](https://support.discord.com/hc/en-us/articles/210298617).
