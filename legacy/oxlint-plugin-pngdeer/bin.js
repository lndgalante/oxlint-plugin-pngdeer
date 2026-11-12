#!/usr/bin/env node
// Arguments are quoted for a POSIX shell so the printed command can be pasted as it is.
const quote = (word) => (/^[\w@%+:,./-][\w@%+=:,./-]*$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);
const command = ["npx", "oxlint-plugin-slimdeer", ...process.argv.slice(2).map(quote)].join(" ");
process.stderr.write(`oxlint-plugin-pngdeer is now oxlint-plugin-slimdeer. Run the same command with the new name:
  ${command}
Nothing was checked or changed. Every step of the move: https://github.com/lndgalante/oxlint-plugin-slimdeer#moving-from-oxlint-plugin-pngdeer
`);
process.exitCode = 2;
