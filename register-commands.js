require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN belum ditetapkan di .env');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('list')
    .setDescription('Tampilkan daftar anime yuri terkini')
    .addIntegerOption((option) =>
      option
        .setName('page')
        .setDescription('Nomor halaman (default 1)')
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Cari anime yuri berdasarkan kata kunci')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Kata kunci pencarian')
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('page')
        .setDescription('Nomor halaman (default 1)')
        .setMinValue(1)
    ),
  new SlashCommandBuilder()
    .setName('yhelp')
    .setDescription('Tampilkan bantuan dan daftar perintah'),
].map((command) => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function main() {
  const clientId = process.env.CLIENT_ID;
  const guildId = process.env.GUILD_ID;

  if (!clientId) {
    console.error('CLIENT_ID belum ditetapkan di .env');
    process.exit(1);
  }

  try {
    if (guildId) {
      console.log(`Mendaftarkan perintah guild untuk ${guildId}...`);
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    } else {
      console.log('Mendaftarkan perintah global...');
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
    }
    console.log('Perintah slash berhasil didaftarkan.');
  } catch (error) {
    console.error('Gagal mendaftarkan perintah:', error);
  }
}

main();
