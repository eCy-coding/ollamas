// Templater user script: Obsidian'dan Claude Code başlat
// Kullanım (template içinde): <% tp.user.launchClaude() %>
function launchClaude() {
  const { exec } = require('child_process');
  const home = process.env.HOME;
  exec(`open -a Terminal "${home}/ollamas-vault/_bin/Claude Code.command"`);
  return "▶ Claude Code başlatıldı (Terminal)";
}
module.exports = launchClaude;
