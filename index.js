require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const fetch = (...args) =>
  import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const JIKAN_BASE = process.env.JIKAN_BASE || 'https://api.jikan.moe/v4';
const GIRLS_LOVE_GENRE_ID = parseInt(process.env.JIKAN_GENRE_ID || '26', 10);
const LIST_PER_PAGE = parseInt(process.env.LIST_PER_PAGE || '10', 10);
const CHECK_INTERVAL_MINUTES = parseInt(process.env.CHECK_INTERVAL_MINUTES || '30', 10);
const MAX_INITIAL_POSTS = parseInt(process.env.MAX_INITIAL_POSTS || '3', 10);
const PAGES_TO_SCAN = parseInt(process.env.PAGES_TO_SCAN || '1', 10);
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'data', 'state.json');

if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN belum ditetapkan di .env');
  process.exit(1);
}
if (!CHANNEL_ID) {
  console.error('CHANNEL_ID belum ditetapkan di .env');
  process.exit(1);
}

ensureStateDir();
let state = loadState();
if (!state.knownAnime) state.knownAnime = {};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`Logged in sebagai ${client.user.tag}`);
  schedulePolling();
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'list') {
      const page = interaction.options.getInteger('page') || 1;
      await interaction.deferReply();
      try {
        const pageData = await fetchGenrePage(page);
        const animeList = pageData.data || [];
        if (!animeList.length) {
          await interaction.editReply(`Tidak ada data untuk halaman ${page}.`);
          return;
        }
        const pageInfo = pageData.pagination || {};
        const embed = buildListEmbed(animeList, page, pageInfo);
        const components = buildListComponents(page, pageInfo);
        await interaction.editReply({ embeds: [embed], components });
      } catch (err) {
        const notFound = err?.status === 404;
        if (notFound) {
          await interaction.editReply(`Halaman ${page} tidak tersedia atau tidak ditemukan.`);
          return;
        }
        console.error('Gagal memproses /list:', err);
        if (err?.body) console.error('Detail Jikan:', JSON.stringify(err.body, null, 2));
        await interaction.editReply('Terjadi kesalahan saat mengambil data. Coba lagi nanti.');
      }
      return;
    }

    if (interaction.commandName === 'search') {
      const query = interaction.options.getString('query');
      const page = interaction.options.getInteger('page') || 1;
      await interaction.deferReply();
      try {
        const payload = await fetchSearchResults(query, page);
        const results = payload.data || [];
        if (!results.length) {
          await interaction.editReply(`Tidak ada hasil untuk "${query}".`);
          return;
        }
        const embed = buildSearchEmbed(results, query, page, payload.pagination || {});
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        const notFound = err?.status === 404;
        if (notFound) {
          await interaction.editReply(`Halaman ${page} tidak tersedia untuk pencarian tersebut.`);
          return;
        }
        console.error('Gagal memproses /search:', err);
        if (err?.body) console.error('Detail Jikan:', JSON.stringify(err.body, null, 2));
        await interaction.editReply('Terjadi kesalahan saat mencari data. Coba lagi nanti.');
      }
      return;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('list:page:')) {
      const segments = interaction.customId.split(':');
      const targetPage = parseInt(segments[2], 10);
      if (!Number.isInteger(targetPage) || targetPage < 1) {
        await interaction.reply({ content: 'Nomor halaman tidak valid.', ephemeral: true });
        return;
      }
      try {
        const pageData = await fetchGenrePage(targetPage);
        const animeList = pageData.data || [];
        if (!animeList.length) {
          await interaction.reply({ content: `Halaman ${targetPage} kosong.`, ephemeral: true });
          return;
        }
        const pageInfo = pageData.pagination || {};
        const embed = buildListEmbed(animeList, targetPage, pageInfo);
        const components = buildListComponents(targetPage, pageInfo);
        await interaction.update({ embeds: [embed], components });
      } catch (err) {
        const notFound = err?.status === 404;
        if (notFound) {
          await interaction.reply({ content: `Halaman ${targetPage} tidak tersedia.`, ephemeral: true });
          return;
        }
        console.error('Gagal memproses tombol daftar:', err);
        if (err?.body) console.error('Detail Jikan:', JSON.stringify(err.body, null, 2));
        await interaction.reply({ content: 'Terjadi kesalahan saat memuat halaman.', ephemeral: true });
      }
    }
  }
});

client.login(DISCORD_TOKEN);

let pollTimeout = null;
function schedulePolling() {
  if (pollTimeout) clearTimeout(pollTimeout);
  pollTimeout = setTimeout(runPollingCycle, 5_000);
}

async function runPollingCycle() {
  try {
    await scanAndNotify();
  } catch (err) {
    console.error('Gagal menjalankan siklus polling:', err);
  } finally {
    pollTimeout = setTimeout(runPollingCycle, Math.max(1, CHECK_INTERVAL_MINUTES) * 60_000);
  }
}

async function scanAndNotify() {
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel || !channel.isTextBased()) {
    console.warn('Channel tidak ditemukan atau bukan text channel.');
    return;
  }

  const firstRun = !state.initializedAt;
  const listItems = await fetchCompleteGenreList(PAGES_TO_SCAN);
  if (!listItems.length) {
    console.warn('Tidak menemukan anime yuri pada API Jikan.');
    return;
  }

  const announcements = [];
  const episodeUpdates = [];

  for (const anime of listItems) {
    const animeKey = String(anime.mal_id);
    const record = state.knownAnime[animeKey];
    const episodeInfo = extractEpisodeInfo(anime);

    if (!record) {
      announcements.push({ anime, episodeInfo });
      state.knownAnime[animeKey] = buildStateEntry(anime, episodeInfo);
    } else if (isEpisodeNew(record, episodeInfo)) {
      episodeUpdates.push({ anime, episodeInfo });
      state.knownAnime[animeKey] = buildStateEntry(anime, episodeInfo, true);
    } else {
      state.knownAnime[animeKey].lastSeenAt = new Date().toISOString();
    }
  }

  if (!state.initializedAt) {
    state.initializedAt = new Date().toISOString();
  }

  await saveState();

  if (announcements.length) {
    const itemsToSend = firstRun ? announcements.slice(0, MAX_INITIAL_POSTS) : announcements;
    for (const item of itemsToSend) {
      const embed = buildAnimeEmbed(item.anime, {
        titlePrefix: 'Rilis Baru',
        episodeNumber: item.episodeInfo?.number ?? null,
      });
      await channel.send({ embeds: [embed] });
    }
  }

  if (episodeUpdates.length) {
    for (const item of episodeUpdates) {
      const embed = buildAnimeEmbed(item.anime, {
        titlePrefix: 'Episode Baru',
        episodeNumber: item.episodeInfo?.number ?? null,
      });
      await channel.send({ embeds: [embed] });
    }
  }

  await saveState();
}

async function fetchCompleteGenreList(pages) {
  const acc = [];
  for (let page = 1; page <= Math.max(1, pages); page += 1) {
    try {
      const pageData = await fetchGenrePage(page);
      const media = pageData.data || [];
      acc.push(...media);
      if (!pageData.pagination?.has_next_page) break;
    } catch (err) {
      console.error(`Gagal memuat halaman genre ${page}:`, err);
      if (err?.body) console.error('Detail Jikan:', JSON.stringify(err.body, null, 2));
      break;
    }
  }
  return acc;
}

async function fetchGenrePage(page) {
  const limit = Math.min(Math.max(1, LIST_PER_PAGE), 25);
  const url = `${JIKAN_BASE}/anime?genres=${GIRLS_LOVE_GENRE_ID}&page=${page}&order_by=score&sort=desc&sfw=false&limit=${limit}`;
  const payload = await requestJikan(url);
  if (!payload?.data?.length) {
    const error = new Error('Page not found');
    error.status = 404;
    error.body = payload;
    throw error;
  }
  return payload;
}

async function fetchSearchResults(query, page) {
  const limit = Math.min(Math.max(1, LIST_PER_PAGE), 25);
  const params = new URLSearchParams({
    q: query,
    genres: String(GIRLS_LOVE_GENRE_ID),
    page: String(Math.max(1, page || 1)),
    order_by: 'score',
    sort: 'desc',
    sfw: 'false',
    limit: String(limit),
  });
  const url = `${JIKAN_BASE}/anime?${params.toString()}`;
  const payload = await requestJikan(url);
  if (!payload?.data?.length) {
    const error = new Error('Page not found');
    error.status = 404;
    error.body = payload;
    throw error;
  }
  return payload;
}

async function requestJikan(url) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  const text = await res.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      console.warn('Gagal parse respons Jikan:', err);
    }
  }

  if (!res.ok) {
    const error = new Error(`Permintaan Jikan gagal (${res.status} ${res.statusText})`);
    error.status = res.status;
    error.body = json;
    throw error;
  }

  return json;
}

function extractEpisodeInfo(anime) {
  if (typeof anime.episodes !== 'number') return null;
  return {
    number: anime.episodes,
  };
}

function buildStateEntry(anime, episodeInfo, updated = false) {
  const entry = {
    lastSeenAt: new Date().toISOString(),
    episodeCount: typeof anime.episodes === 'number' ? anime.episodes : null,
  };
  if (episodeInfo?.number !== undefined && episodeInfo.number !== null) {
    entry.latestEpisodeNumber = episodeInfo.number;
  }
  if (updated) entry.lastUpdatedAt = new Date().toISOString();
  return entry;
}

function isEpisodeNew(record, episodeInfo) {
  if (!episodeInfo || typeof episodeInfo.number !== 'number') return false;
  const previous = typeof record?.episodeCount === 'number' ? record.episodeCount : null;
  if (previous === null) return true;
  return episodeInfo.number > previous;
}

function buildAnimeEmbed(anime, { titlePrefix, episodeNumber } = {}) {
  const embed = new EmbedBuilder();
  const title = resolveTitle(anime);
  const url = anime.url || null;
  const description = cleanDescription(anime.synopsis || '');
  const status = formatStatus(anime.status);
  const score = formatScore(anime.score);
  const episodes = typeof anime.episodes === 'number' ? String(anime.episodes) : '-';
  const season = formatSeason(anime.season, anime.year);

  embed.setTitle(`${titlePrefix ? `${titlePrefix} · ` : ''}${title}`);
  if (url) embed.setURL(url);
  if (description) embed.setDescription(truncate(description, 350));
  const poster = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url;
  if (poster) embed.setThumbnail(poster);
  embed.setColor(0xf06292);

  const fields = [];
  if (status) fields.push({ name: 'Status', value: status, inline: true });
  if (anime.type) fields.push({ name: 'Format', value: anime.type, inline: true });
  if (season) fields.push({ name: 'Musim', value: season, inline: true });
  if (episodes) fields.push({ name: 'Total Episode', value: episodes, inline: true });
  if (score) fields.push({ name: 'Skor', value: score, inline: true });

  if (typeof episodeNumber === 'number') {
    fields.push({ name: 'Episode Terbaru', value: `Episode ${episodeNumber}`, inline: false });
  }

  const broadcast = anime.broadcast?.string;
  if (broadcast) {
    fields.push({ name: 'Jadwal Tayang', value: broadcast, inline: false });
  }

  if (fields.length) embed.addFields(fields);
  embed.setTimestamp(new Date());
  return embed;
}

function buildListEmbed(animeList, page, pagination) {
  const embed = new EmbedBuilder()
    .setTitle(`Daftar Anime Yuri · Halaman ${page}`)
    .setColor(0xba68c8)
    .setTimestamp(new Date());

  const descriptionLines = animeList.slice(0, 10).map((item, index) => {
    const idx = (index + 1).toString().padStart(2, '0');
    const name = resolveTitle(item);
    const status = item.status ? ` — ${formatStatus(item.status)}` : '';
    const score = formatScore(item.score);
    const scoreText = score ? ` (Skor: ${score})` : '';
    return `${idx}. ${name}${status}${scoreText}`;
  });

  embed.setDescription(descriptionLines.join('\n'));
  const poster = animeList[0]?.images?.jpg?.large_image_url || animeList[0]?.images?.jpg?.image_url;
  if (poster) {
    embed.setThumbnail(poster);
  }

  const footerParts = [];
  if (pagination?.current_page > 1) footerParts.push(`Prev: ${page - 1}`);
  if (pagination?.has_next_page) footerParts.push(`Next: ${page + 1}`);
  if (footerParts.length) embed.setFooter({ text: footerParts.join(' | ') });

  return embed;
}

function resolveTitle(anime) {
  if (!anime) return 'Anime';
  return (
    anime.title_english ||
    anime.title ||
    anime.title_japanese ||
    (Array.isArray(anime.titles) ? anime.titles[0]?.title : null) ||
    'Anime'
  );
}

function formatScore(value) {
  if (typeof value !== 'number') return null;
  return value.toFixed(1);
}

function cleanDescription(text) {
  if (!text) return '';
  return text.replace(/<br\s*\/?>(\n)?/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

function formatStatus(value) {
  if (!value) return null;
  return value
    .toString()
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatSeason(season, year) {
  if (!season && !year) return null;
  if (season && year) return `${capitalize(season)} ${year}`;
  if (season) return capitalize(season);
  return String(year);
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : text;
}

function ensureStateDir() {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { knownAnime: {} };
  }
}

async function saveState() {
  const payload = JSON.stringify(state, null, 2);
  await fs.promises.writeFile(STATE_FILE, payload, 'utf8');
}

process.on('SIGINT', () => {
  console.log('Menangkap SIGINT, menyimpan state...');
  saveState().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('Menangkap SIGTERM, menyimpan state...');
  saveState().finally(() => process.exit(0));
});

function truncate(text, limit) {
  if (!text) return text;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3)}...`;
}
