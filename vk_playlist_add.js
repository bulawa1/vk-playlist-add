// ─── НАСТРОЙКИ ────────────────────────────────────────────────────────────────

const TOKEN       = 'ВАШ_ТОКЕН_СЮАД';
const OWNER_ID    = ВАШ_owner-id_СЮДА;
const PLAYLIST_ID = ВАШ_playlist-id_СЮДА;
const ACCESS_HASH = '';

// Если скрипт прервался — поставь номер последнего успешного трека
const START_FROM  = 94;

const VK_API_VERSION  = '5.131';
const DELAY_MS        = 2000;   // 2 сек между треками
const CAPTCHA_WAIT_MS = 3 * 60 * 1000; // 3 минуты ждём когда капча спадёт

// ──────────────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Красивый обратный отсчёт в одну строку
async function countdown(ms, label) {
  const total = Math.ceil(ms / 1000);
  for (let i = total; i > 0; i--) {
    process.stdout.write(`\r  ⏳ ${label}: ещё ${i} сек...   `);
    await sleep(1000);
  }
  process.stdout.write('\r' + ' '.repeat(50) + '\r');
}

async function vkCall(method, params = {}) {
  const url = new URL(`https://api.vk.com/method/${method}`);
  const all = { access_token: TOKEN, v: VK_API_VERSION, ...params };
  for (const [k, v] of Object.entries(all)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  const res  = await fetch(url.toString());
  const data = await res.json();
  if (data.error) {
    const err = new Error(`VK API Error ${data.error.error_code}: ${data.error.error_msg}`);
    err.code = data.error.error_code;
    throw err;
  }
  return data.response;
}

// Добавляет трек, при капче — ждёт и повторяет бесконечно
async function addTrack(track) {
  let attempt = 0;
  while (true) {
    try {
      await vkCall('audio.add', { audio_id: track.id, owner_id: track.owner_id });
      return { ok: true };
    } catch (err) {
      if (err.code === 14) {
        attempt++;
        console.log(`\n  🔒 Капча (попытка ${attempt}). Жду 3 минуты пока VK успокоится...`);
        await countdown(CAPTCHA_WAIT_MS, 'капча');
        // после паузы пробуем снова (бесконечно)
      } else if (err.code === 15 || err.code === 201) {
        return { ok: false, error: 'трек недоступен' };
      } else {
        return { ok: false, error: err.message };
      }
    }
  }
}

async function getPlaylistTracks() {
  const COUNT = 100;
  let offset  = 0;
  let tracks  = [];
  console.log('📋 Загружаю треки из плейлиста...');
  while (true) {
    const res = await vkCall('audio.get', {
      owner_id:   OWNER_ID,
      album_id:   PLAYLIST_ID,
      access_key: ACCESS_HASH || undefined,
      count:      COUNT,
      offset,
    });
    if (!res || !res.items || res.items.length === 0) break;
    tracks = tracks.concat(res.items);
    console.log(`  Загружено: ${tracks.length} / ${res.count}`);
    if (tracks.length >= res.count) break;
    offset += COUNT;
    await sleep(600);
  }
  return tracks;
}

async function main() {
  if (TOKEN === 'ВАШ_ТОКЕН_СЮДА') {
    console.error('❌ Укажите токен в переменной TOKEN!');
    process.exit(1);
  }

  let tracks;
  try {
    tracks = await getPlaylistTracks();
  } catch (err) {
    console.error('❌ Не удалось загрузить плейлист:', err.message);
    process.exit(1);
  }

  if (!tracks || tracks.length === 0) {
    console.log('⚠️  Плейлист пустой или недоступен.');
    return;
  }

  const startIdx = Math.max(0, START_FROM - 1);
  const total    = tracks.length - startIdx;
  const estMin   = Math.round(total * DELAY_MS / 60000);

  console.log(`\n🎵 Найдено треков: ${tracks.length}`);
  if (startIdx > 0) console.log(`⏩ Начинаю с трека #${START_FROM}`);
  console.log(`⏱️  ~${estMin} минут без капч (при капче +3 мин на паузу)`);
  console.log('➕ Начинаю добавление...\n');

  let added = 0, failed = 0;
  const errors = [];

  for (let i = startIdx; i < tracks.length; i++) {
    const track = tracks[i];
    const label = `${track.artist} — ${track.title}`;
    process.stdout.write(`[${i + 1}/${tracks.length}] ${label} ... `);

    const result = await addTrack(track);

    if (result.ok) {
      added++;
      console.log('✅');
    } else {
      failed++;
      errors.push({ num: i + 1, label, error: result.error });
      console.log(`❌ (${result.error})`);
    }

    await sleep(DELAY_MS);
  }

  console.log('\n──────────────────────────────');
  console.log(`✅ Добавлено:     ${added}`);
  console.log(`❌ Не добавлено: ${failed}`);
  if (errors.length > 0) {
    console.log('\nНе добавились:');
    for (const e of errors) console.log(`  #${e.num} ${e.label}: ${e.error}`);
  }
  console.log('\n🎉 Готово!');
}

main();
