import fs from 'node:fs';

const [file, from, to] = process.argv.slice(2);

if (!file || !from || to === undefined) {
  console.error('Usage: node scripts/replace-text.mjs <file> <from> <to>');
  process.exit(1);
}

const oldText = fs.readFileSync(file, 'utf8');

if (!oldText.includes(from)) {
  console.error(`Target text not found in ${file}`);
  process.exit(2);
}

const newText = oldText.replace(from, to);

if (newText === oldText) {
  console.error(`No change made to ${file}`);
  process.exit(3);
}

fs.writeFileSync(file, newText, 'utf8');

console.log(`Updated ${file}`);
