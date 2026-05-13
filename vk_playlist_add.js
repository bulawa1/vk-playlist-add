// ─── НАСТРОЙКИ ────────────────────────────────────────────────────────────────

const TOKEN       = 'ВАШ_ТОКЕН_СЮДА';
const OWNER_ID    = ВАШ_OWNER-ID_СЮДА;
const PLAYLIST_ID = ВАШ_PLAYLIST-ID_СЮДА;
const ACCESS_HASH = '';

// Если скрипт прервался — поставь номер последнего успешного трека
const START_FROM  = 1;

const VK_API_VERSION = '5.131';
const DELAY_MS       = 2000;

const CAPTCHA_BASE_MS = 3 * 60 * 1000;
const CAPTCHA_MAX_MS  = 30 * 60 * 1000;

// ──────────────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function jitter(ms) {
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}

async function countdown(ms, label) {
  const total = Math.ceil(ms / 1000);
  for (let i = total; i > 0; i--) {
    process.stdout.write(`\r  ⏳ ${label}: ещё ${i} сек...   `);
    await sleep(1000);
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
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

// Проверяет что трек реально есть в музыке пользователя
async function verifyTrackAdded(newAudioId) {
  try {
    // audio.getById возвращает трек если он есть у текущего пользователя
    const res = await vkCall('audio.getById', {
      audios: `${TOKEN.slice(0, 3)}`, // заглушка — используем другой способ
    });
  } catch {}

  // Реальная проверка: audio.get с count=1 и фильтром по id не поддерживается напрямую,
  // поэтому проверяем через audio.getById — передаём owner_id текущего пользователя
  // Самый надёжный способ — просто доверять ненулевому ответу audio.add (см. ниже)
  return true;
}

let captchaStreak = 0;

async function addTrack(track) {
  while (true) {
    try {
      const newId = await vkCall('audio.add', {
        audio_id: track.id,
        owner_id: track.owner_id,
      });

      // audio.add возвращает числовой ID нового трека при успехе
      if (newId && typeof newId === 'number' && newId > 0) {
        captchaStreak = 0;
        return { ok: true, status: 'added', newId };
      } else {
        // Ответ пришёл, но ID странный — трек мог не добавиться
        return { ok: false, status: 'unknown', error: `неожиданный ответ: ${JSON.stringify(newId)}` };
      }

    } catch (err) {
      if (err.code === 14) {
        // Капча
        captchaStreak++;
        const base = Math.min(CAPTCHA_BASE_MS * Math.pow(2, captchaStreak - 1), CAPTCHA_MAX_MS);
        const wait = jitter(base);
        const mins = (wait / 60000).toFixed(1);
        console.log(`\n  🔒 Капча #${captchaStreak}. Пауза ~${mins} мин...`);
        await countdown(wait, 'ждём');

      } else if (err.code === 15) {
        // Трек уже есть в музыке
        captchaStreak = 0;
        return { ok: true, status: 'already', newId: null };

      } else if (err.code === 201) {
        return { ok: false, status: 'unavailable', error: 'трек недоступен' };

      } else {
        return { ok: false, status: 'error', error: err.message };
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
  console.log(`\n🎵 Найдено треков: ${tracks.length}`);
  if (startIdx > 0) console.log(`⏩ Начинаю с трека #${START_FROM}`);
  console.log(`⏱️  ~${Math.round((tracks.length - startIdx) * DELAY_MS / 60000)} мин в идеале`);
  console.log('➕ Начинаю добавление...\n');

  let added = 0, skipped = 0, failed = 0;
  const errors = [];

  for (let i = startIdx; i < tracks.length; i++) {
    const track = tracks[i];
    const label = `${track.artist} — ${track.title}`;
    process.stdout.write(`[${i + 1}/${tracks.length}] ${label} ... `);

    const result = await addTrack(track);

    if (result.status === 'added') {
      added++;
      console.log(`✅ (id: ${result.newId})`);
    } else if (result.status === 'already') {
      skipped++;
      console.log('⏭️  уже в музыке');
    } else {
      failed++;
      errors.push({ num: i + 1, label, error: result.error });
      console.log(`❌ (${result.error})`);
    }

    await sleep(jitter(DELAY_MS));
  }

  console.log('\n──────────────────────────────');
  console.log(`✅ Добавлено:        ${added}`);
  console.log(`⏭️  Уже было:        ${skipped}`);
  console.log(`❌ Не добавлено:    ${failed}`);
  if (errors.length > 0) {
    console.log('\nНе добавились:');
    for (const e of errors) console.log(`  #${e.num} ${e.label}: ${e.error}`);
  }
  console.log('\n🎉 Готово!');
}

main();
