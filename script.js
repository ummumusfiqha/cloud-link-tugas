/* =========================================================
   Cloud Link Tugas — AlphaCloud (prototype)
   - Data akun/tugas/pengumpulan: localStorage (cache) + Supabase (cloud)
   - Berkas: IndexedDB + Supabase Storage, dienkripsi AES-GCM lewat Web Crypto
   - Hanya untuk demo. Produksi butuh backend, hash sandi, SSL.
   ========================================================= */
'use strict';

/* ---------- Aturan dari dokumen proyek ---------- */
const MAX_BYTES = 25 * 1024 * 1024;               // 25 MB per pengiriman
const ALLOWED = ['pdf','doc','docx','ppt','pptx','xls','xlsx','txt','zip','rar','jpg','jpeg','png','sql','html','css','js','py'];
const UPTIME_TARGET = 99.5;                        // %
const SOP = [                                      // SOP-TECH-001 (menit)
  { name:'Deteksi & Identifikasi', limit:15, desc:'Mendeteksi dan mengidentifikasi jenis kendala sistem yang muncul.' },
  { name:'Isolasi Penyebab',       limit:30, desc:'Membatasi sumber masalah agar tidak berdampak ke layanan lainnya.' },
  { name:'Perbaikan & Recovery',   limit:45, desc:'Melakukan perbaikan code/server dan pemulihan operasional.' },
  { name:'Verifikasi & Pelaporan', limit:30, desc:'Pengujian ulang pasca-perbaikan serta pembuatan laporan insiden.' }
];

/* Akun bawaan. Akun yang didaftarkan pengguna disimpan di localStorage ('clt.users')
   dan dimuat ke array ini saat halaman dibuka. */
const USERS = [
  { id:'s1', username:'siswa', password:'siswa123', role:'siswa', name:'Muhammad Aditya', kelas:'XI RPL 1' },
  { id:'s2', username:'siswa2', password:'siswa123', role:'siswa', name:'Nur Aisyah', kelas:'XI RPL 1' },
  { id:'s3', username:'siswa3', password:'siswa123', role:'siswa', name:'Rizky Pratama', kelas:'XI RPL 1' },
  { id:'g1', username:'guru', password:'guru123', role:'guru', name:'Bu Nurul Hidayah, S.Kom', kelas:'' },
  { id:'a1', username:'admin', password:'admin123', role:'admin', name:'Tim Operasional', kelas:'' }
];
const ROLE_LABEL = { siswa:'Siswa', guru:'Guru', admin:'Tim Operasional' };

/* ---------- Cloud (Supabase) ---------- */
const SUPABASE_URL = 'https://juqrjdhpyvddouiiigki.supabase.co';
const SUPABASE_KEY = 'sb_publishable_H1FU_qLfiplPii1gs4tZkQ_pxmg5qKw';
const BUCKET = 'tugas';
const SYNC = ['assignments','subs','users','incidents','tickets','key'];
const sb = window.supabase ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

async function cloudPull() {
  if (!sb) return;
  const { data, error } = await sb.from('kv').select('key,value');
  if (error) { toast('Cloud tidak terhubung, memakai data lokal.', 'error'); return; }
  data.forEach(r => localStorage.setItem('clt.' + r.key, JSON.stringify(r.value)));
  if (data.some(r => r.key === 'assignments')) localStorage.setItem('clt.seeded', 'true');
  else SYNC.forEach(k => { const v = store.get(k); if (v !== undefined) store.set(k, v); });
}
function mergeUsers() {
  store.get('users', []).forEach(u => { if (!USERS.some(x => x.id === u.id || x.username === u.username)) USERS.push(u); });
}
function cloudListen() {
  if (!sb) return;
  sb.channel('kv-sync').on('postgres_changes', { event:'*', schema:'public', table:'kv' }, p => {
    const r = p.new; if (!r || !r.key) return;
    const s = JSON.stringify(r.value);
    if (localStorage.getItem('clt.' + r.key) === s) return;
    localStorage.setItem('clt.' + r.key, s);
    if (r.key === 'users') mergeUsers();
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (me && !$('#app').hidden && !$('#modal').open && !typing) renderApp();
  }).subscribe();
}
async function cloudUpload(id, rec) {
  if (!sb) return;
  const head = new Uint8Array(13); head[0] = rec.enc ? 1 : 0; if (rec.iv) head.set(rec.iv, 1);
  const { error } = await sb.storage.from(BUCKET).upload(id, new Blob([head, rec.data]), { upsert:true, contentType:'application/octet-stream' });
  if (error) throw error;
}
async function cloudDownload(id) {
  if (!sb) return null;
  const { data, error } = await sb.storage.from(BUCKET).download(id);
  if (error || !data) return null;
  const all = await data.arrayBuffer(); const h = new Uint8Array(all, 0, 13);
  return { enc: h[0] === 1, iv: h.slice(1, 13), data: all.slice(13), type:'' };
}

const FAQ = [
  ['Berapa ukuran berkas maksimal?', 'Maksimal 25 MB per pengiriman tugas. Jika berkas lebih besar, kompres menjadi ZIP atau kirim lewat tab Tautan.'],
  ['Jenis berkas apa yang diterima?', 'Berkas dengan ekstensi: ' + ALLOWED.join(', ') + '. Jenis lain ditolak oleh sistem.'],
  ['Bisakah saya mengganti berkas yang sudah dikirim?', 'Bisa, selama tugas belum dinilai guru. Pengiriman baru otomatis menggantikan yang lama.'],
  ['Bagaimana jika saya terlambat?', 'Tugas tetap bisa dikirim, tetapi ditandai "Terlambat" agar guru tahu waktunya.'],
  ['Apakah berkas saya aman?', 'Berkas valid disimpan terenkripsi. Di prototype ini enkripsi AES-GCM berjalan di browser. Versi produksi memakai SSL, firewall, enkripsi di server, dan backup berkala.'],
  ['Apa yang terjadi jika koneksi internet terputus?', 'Platform membutuhkan internet. Jika pengiriman gagal, ulangi setelah koneksi pulih. Hubungi dukungan jika masalah berlanjut.'],
  ['Bagaimana guru mengambil tugas saya?', 'Guru membuka menu Pengumpulan, lalu memilih Buka (untuk tautan) atau Unduh (untuk berkas).']
];

/* ---------- Util ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = p => p + Math.random().toString(36).slice(2, 9);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const nf3 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });
const fmtSize = b => b >= 1048576 ? nf.format(b / 1048576) + ' MB' : b >= 1024 ? nf.format(b / 1024) + ' KB' : b + ' B';
const dtf = new Intl.DateTimeFormat('id-ID', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
const df = new Intl.DateTimeFormat('id-ID', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
const fmtDT = t => dtf.format(new Date(t));
const fmtD = t => df.format(new Date(t));
const DAY = 864e5;
const normKelas = v => v.trim().replace(/\s+/g, ' ').toUpperCase();
function rel(t) {
  const d = t - Date.now(), a = Math.abs(d);
  const txt = a < 36e5 ? Math.max(1, Math.round(a / 6e4)) + ' menit' : a < DAY ? Math.round(a / 36e5) + ' jam' : Math.round(a / DAY) + ' hari';
  return d >= 0 ? txt + ' lagi' : 'lewat ' + txt;
}

const store = {
  get(k, d) { try { const v = localStorage.getItem('clt.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem('clt.' + k, JSON.stringify(v)); } catch { toast('Penyimpanan browser penuh.', 'error'); }
    if (sb && SYNC.includes(k)) sb.from('kv').upsert({ key:k, value:v }).then(({ error }) => { if (error) toast('Gagal sinkron ke cloud.', 'error'); });
  }
};

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4200);
}

/* ---------- Data & seed ---------- */
function seed() {
  if (store.get('seeded')) return;
  const n = Date.now();
  store.set('assignments', [
    { id:'a1', title:'Rancangan ERD Toko Online', mapel:'Basis Data', kelas:'XI RPL 1', due:n + 2*DAY, desc:'Buat ERD lengkap dengan minimal 5 entitas. Kumpulkan dalam PDF atau tautan draw.io.' },
    { id:'a2', title:'Landing Page HTML & CSS', mapel:'Pemrograman Web', kelas:'XI RPL 1', due:n + 5*DAY, desc:'Satu halaman responsif tentang produk fiktif. Kumpulkan dalam ZIP atau tautan repositori.' },
    { id:'a3', title:'Topologi Jaringan Sekolah', mapel:'Jaringan Komputer', kelas:'XI RPL 1', due:n - 1*DAY, desc:'Gambar topologi jaringan lab komputer beserta penjelasan singkat.' },
    { id:'a4', title:'Resensi Buku Fiksi', mapel:'Bahasa Indonesia', kelas:'XI RPL 1', due:n + 9*DAY, desc:'Resensi 400–600 kata. Format DOCX atau PDF.' }
  ]);
  store.set('subs', [
    { id:'p1', aid:'a1', uid:'s2', kind:'link', name:'ERD draw.io — Aisyah', url:'https://example.com/erd-aisyah', note:'', at:n - 4*36e5, score:null, feedback:'' },
    { id:'p2', aid:'a1', uid:'s3', kind:'link', name:'ERD kelompok 3', url:'https://example.com/erd-rizky', note:'Mohon dicek relasi M:N', at:n - 2*36e5, score:null, feedback:'' },
    { id:'p3', aid:'a3', uid:'s1', kind:'link', name:'Topologi di Figma', url:'https://example.com/topologi-aditya', note:'', at:n - 2*DAY, score:88, feedback:'Topologi jelas. Tambahkan label IP.' },
    { id:'p4', aid:'a3', uid:'s2', kind:'link', name:'Topologi Aisyah', url:'https://example.com/topologi-aisyah', note:'', at:n - 5*36e5, score:null, feedback:'' }
  ]);
  const t0 = n - 2*DAY;
  store.set('incidents', [
    { id:'i1', title:'Contoh simulasi: lonjakan unggahan saat tenggat', level:'Normal', createdAt:t0, closed:true,
      stages:[ {s:t0, e:t0+12*6e4}, {s:t0+12*6e4, e:t0+37*6e4}, {s:t0+37*6e4, e:t0+77*6e4}, {s:t0+77*6e4, e:t0+105*6e4} ] }
  ]);
  store.set('tickets', []);
  store.set('seeded', true);
}
const A = () => store.get('assignments', []);
const S = () => store.get('subs', []);
const INC = () => store.get('incidents', []);
const userById = id => USERS.find(u => u.id === id);
const asgById = id => A().find(a => a.id === id);

/* ---------- Penyimpanan berkas terenkripsi ---------- */
const idb = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('clt-files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction('files', mode); const out = fn(t.objectStore('files'));
      t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error);
    });
  },
  put(k, v) { return this.tx('readwrite', s => s.put(v, k)); },
  get(k) { return this.tx('readonly', s => s.get(k)); },
  del(k) { sb?.storage.from(BUCKET).remove([k]); return this.tx('readwrite', s => s.delete(k)); },
  clear() { return this.tx('readwrite', s => s.clear()); }
};
async function getKey() {
  if (!window.crypto || !crypto.subtle) return null;
  const algo = { name:'AES-GCM' };
  let jwk = store.get('key');
  if (!jwk && sb) {
    const { data } = await sb.from('kv').select('value').eq('key', 'key').maybeSingle();
    if (data) { jwk = data.value; localStorage.setItem('clt.key', JSON.stringify(jwk)); }
  }
  if (jwk) return crypto.subtle.importKey('jwk', jwk, algo, true, ['encrypt','decrypt']);
  const k = await crypto.subtle.generateKey({ ...algo, length:256 }, true, ['encrypt','decrypt']);
  store.set('key', await crypto.subtle.exportKey('jwk', k));
  return k;
}
async function saveFile(id, file) {
  const buf = await file.arrayBuffer();
  const key = await getKey();
  let rec;
  if (key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, buf);
    rec = { enc:true, iv, data, type:file.type };
  } else rec = { enc:false, data:buf, type:file.type };
  await idb.put(id, rec);
  await cloudUpload(id, rec);
  return rec.enc;
}
async function loadFile(id) {
  let rec = await idb.get(id);
  if (!rec) rec = await cloudDownload(id);
  if (!rec) return null;
  let buf = rec.data;
  if (rec.enc) buf = await crypto.subtle.decrypt({ name:'AES-GCM', iv:rec.iv }, await getKey(), buf);
  return new Blob([buf], { type: rec.type || 'application/octet-stream' });
}

/* ---------- Sesi & router ---------- */
let me = null;
let view = '';
const session = {
  get() { return sessionStorage.getItem('clt.session'); },
  set(u) { sessionStorage.setItem('clt.session', u); },
  clear() { sessionStorage.removeItem('clt.session'); }
};

function route() {
  const h = location.hash;
  const u = USERS.find(x => x.username === session.get());
  me = u || null;
  const show = { site:false, login:false, app:false };
  if (h.startsWith('#/app')) {
    if (!me) { location.hash = '#/login'; return; }
    show.app = true;
    const wanted = h.split('/')[2];
    view = (NAV[me.role].some(n => n.id === wanted)) ? wanted : NAV[me.role][0].id;
    renderApp();
  } else if (h.startsWith('#/login')) {
    if (me) { location.hash = '#/app'; return; }
    show.login = true;
  } else {
    show.site = true;
  }
  $('#site').hidden = !show.site; $('#login').hidden = !show.login; $('#app').hidden = !show.app;
  if (!show.site && !location.hash.startsWith('#/app/')) window.scrollTo(0, 0);
  document.title = show.app ? 'Cloud Link Tugas — ' + ROLE_LABEL[me.role] : 'Cloud Link Tugas — AlphaCloud';
}

/* ---------- Ikon sederhana ---------- */
const ICON = {
  home:'<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  task:'<path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
  file:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
  server:'<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>'
};
const ico = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const NAV = {
  siswa: [ {id:'beranda',t:'Beranda',i:'home'}, {id:'tugas',t:'Tugas saya',i:'task'}, {id:'berkas',t:'Berkas saya',i:'file'}, {id:'bantuan',t:'Bantuan',i:'help'} ],
  guru:  [ {id:'beranda',t:'Beranda',i:'home'}, {id:'tugas',t:'Kelola tugas',i:'task'}, {id:'berkas',t:'Pengumpulan',i:'file'}, {id:'bantuan',t:'Bantuan',i:'help'} ],
  admin: [ {id:'status',t:'Status sistem',i:'server'}, {id:'bantuan',t:'Bantuan',i:'help'} ]
};

/* ---------- Kerangka aplikasi ---------- */
function renderApp() {
  const nav = NAV[me.role];
  const initials = me.name.split(' ').filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const content = (VIEWS[me.role][view] || (() => ''))();
  $('#app').innerHTML = `
    <aside class="side" id="side">
      <a class="brand" href="#/"><svg class="logo"><use href="#logo"/></svg><span>AlphaCloud</span></a>
      <nav aria-label="Menu utama">
        ${nav.map(n => `<button data-act="nav" data-v="${n.id}" ${n.id === view ? 'aria-current="page"' : ''}>${ico(n.i)}${n.t}</button>`).join('')}
      </nav>
      <div class="side-foot">
        <div class="me"><span class="avatar">${esc(initials)}</span><div><b>${esc(me.name)}</b><small>${me.role === 'admin' ? 'Akun demo' : ROLE_LABEL[me.role]}${me.kelas ? ' · ' + esc(me.kelas) : ''}</small></div></div>
        <button class="btn btn-line btn-sm" data-act="logout">Keluar</button>
        <button class="link-btn" data-act="reset-demo">Atur ulang data demo</button>
      </div>
    </aside>
    <div>
      <div class="mobile-bar"><button class="menu-btn" data-act="toggle-side" aria-label="Buka menu">${ico('menu').replace('<svg','<svg width="26" height="26"')}</button><b>Cloud Link Tugas</b></div>
      <main class="main">${content}</main>
    </div>`;
}
const head = (t, p, extra = '') => `<div class="page-head"><div><h1>${t}<span class="proto-tag">Prototype</span></h1>${p ? `<p>${p}</p>` : ''}</div>${extra}</div>`;
const statusOf = (aid, uidv) => { const s = S().find(x => x.aid === aid && x.uid === uidv); return s ? (s.score != null ? 'dinilai' : 'terkirim') : 'belum'; };
const chipOf = st => st === 'dinilai' ? '<span class="chip ok">Dinilai</span>' : st === 'terkirim' ? '<span class="chip warn">Terkirim</span>' : '<span class="chip muted">Belum dikumpulkan</span>';
const lateChip = (s, a) => a && s.at > a.due ? ' <span class="chip bad">Terlambat</span>' : '';

/* ---------- Tampilan per peran ---------- */
const VIEWS = {
  siswa: {
    beranda() {
      const mine = A().filter(a => a.kelas === me.kelas);
      const st = mine.map(a => statusOf(a.id, me.id));
      const scores = S().filter(s => s.uid === me.id && s.score != null).map(s => s.score);
      const next = mine.filter(a => st[mine.indexOf(a)] === 'belum').sort((x, y) => x.due - y.due).slice(0, 4);
      return head('Halo, ' + esc(me.name.split(' ')[0]), 'Semua tugas kelas ' + esc(me.kelas) + ' ada di satu tempat.') + `
        <div class="stats">
          <div class="stat"><b>${mine.length}</b><span>Total tugas</span></div>
          <div class="stat"><b>${st.filter(x => x !== 'belum').length}</b><span>Sudah dikumpulkan</span></div>
          <div class="stat"><b>${st.filter(x => x === 'belum').length}</b><span>Belum dikumpulkan</span></div>
          <div class="stat dark"><b>${scores.length ? nf.format(scores.reduce((a, b) => a + b, 0) / scores.length) : '–'}</b><span>Rata-rata nilai</span></div>
        </div>
        <section class="panel"><h2>Tenggat terdekat</h2>
          ${next.length ? `<ul class="list">${next.map(a => `<li class="item ${a.due < Date.now() ? 'late' : ''}"><div class="info"><b>${esc(a.title)}</b><small>${esc(a.mapel)} · ${fmtD(a.due)} (${rel(a.due)})</small></div><button class="btn btn-primary btn-sm" data-act="open-submit" data-aid="${a.id}">Kumpulkan</button></li>`).join('')}</ul>` : '<p class="empty">Semua tugas sudah dikumpulkan, atau belum ada tugas untuk kelasmu.</p>'}
        </section>
        <section class="panel"><h2>Aturan pengumpulan</h2>
          <p style="margin:0">Ukuran berkas maksimal <b>25 MB</b>. Jenis berkas: ${ALLOWED.join(', ')}. Berkas valid disimpan terenkripsi. Tugas bisa diganti selama belum dinilai.</p>
        </section>`;
    },
    tugas() {
      const mine = A().filter(a => a.kelas === me.kelas).sort((x, y) => x.due - y.due);
      return head('Tugas saya', 'Pilih tugas, lalu unggah berkas atau tempel tautan.') + `
        <ul class="list">${mine.map(a => {
          const st = statusOf(a.id, me.id);
          return `<li class="item ${st === 'dinilai' ? 'done' : a.due < Date.now() && st === 'belum' ? 'late' : ''}">
            <div class="info"><b>${esc(a.title)}</b><small>${esc(a.mapel)} · Tenggat ${fmtD(a.due)} (${rel(a.due)})</small><p style="margin:.3rem 0 0;font-size:.9rem">${esc(a.desc)}</p></div>
            <div class="acts">${chipOf(st)}<button class="btn ${st === 'belum' ? 'btn-primary' : 'btn-line'} btn-sm" data-act="open-submit" data-aid="${a.id}" ${st === 'dinilai' ? 'disabled' : ''}>${st === 'belum' ? 'Kumpulkan' : st === 'dinilai' ? 'Sudah dinilai' : 'Ganti pengiriman'}</button></div></li>`;
        }).join('') || '<li class="empty">Belum ada tugas untuk kelasmu.</li>'}</ul>`;
    },
    berkas() {
      const mine = S().filter(s => s.uid === me.id).sort((a, b) => b.at - a.at);
      const total = mine.filter(s => s.kind === 'file').reduce((t, s) => t + s.size, 0);
      return head('Berkas saya', 'Semua pengumpulanmu tersimpan rapi di sini.') + `
        <div class="stats"><div class="stat"><b>${mine.length}</b><span>Pengiriman</span></div><div class="stat"><b>${fmtSize(total)}</b><span>Ruang terpakai</span></div></div>
        ${mine.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tugas</th><th>Berkas / tautan</th><th>Dikirim</th><th>Status</th><th></th></tr></thead><tbody>
          ${mine.map(s => { const a = asgById(s.aid); return `<tr>
            <td><b>${esc(a?.title || '(tugas dihapus)')}</b><br><small class="muted">${esc(a?.mapel || '')}</small></td>
            <td>${esc(s.name)}<br><small class="muted">${s.kind === 'file' ? fmtSize(s.size) + (s.encrypted ? ' · terenkripsi' : '') : 'Tautan'}</small></td>
            <td class="nw">${fmtDT(s.at)}${lateChip(s, a)}</td>
            <td>${s.score != null ? `<span class="chip ok">Nilai ${s.score}</span>${s.feedback ? `<br><small class="muted">${esc(s.feedback)}</small>` : ''}` : '<span class="chip warn">Menunggu nilai</span>'}</td>
            <td class="nw"><button class="btn btn-line btn-sm" data-act="open-file" data-sid="${s.id}">${s.kind === 'file' ? 'Unduh' : 'Buka'}</button>
              ${s.score == null ? `<button class="btn btn-danger btn-sm" data-act="del-sub" data-sid="${s.id}">Hapus</button>` : ''}</td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="empty">Belum ada pengiriman. Buka Tugas saya untuk mulai mengumpulkan.</p>'}`;
    },
    bantuan: helpView
  },

  guru: {
    beranda() {
      const subs = S(); const scored = subs.filter(s => s.score != null);
      const recent = subs.filter(s => s.score == null).sort((a, b) => b.at - a.at).slice(0, 5);
      return head('Halo, ' + esc(me.name.split(',')[0]), 'Ringkasan pengumpulan tugas di semua kelas.') + `
        <div class="stats">
          <div class="stat"><b>${A().length}</b><span>Tugas dibuat</span></div>
          <div class="stat"><b>${subs.length}</b><span>Total pengumpulan</span></div>
          <div class="stat"><b>${subs.length - scored.length}</b><span>Perlu dinilai</span></div>
          <div class="stat dark"><b>${scored.length ? nf.format(scored.reduce((t, s) => t + s.score, 0) / scored.length) : '–'}</b><span>Rata-rata nilai</span></div>
        </div>
        <section class="panel"><h2>Menunggu penilaian</h2>
          ${recent.length ? `<ul class="list">${recent.map(s => { const a = asgById(s.aid); return `<li class="item"><div class="info"><b>${esc(userById(s.uid)?.name)}</b><small>${esc(a?.title)} · ${fmtDT(s.at)}${a && s.at > a.due ? ' · terlambat' : ''}</small></div><div class="acts"><button class="btn btn-line btn-sm" data-act="open-file" data-sid="${s.id}">${s.kind === 'file' ? 'Unduh' : 'Buka'}</button><button class="btn btn-primary btn-sm" data-act="grade" data-sid="${s.id}">Beri nilai</button></div></li>`; }).join('')}</ul>` : '<p class="empty">Tidak ada tugas yang menunggu nilai.</p>'}
        </section>`;
    },
    tugas() {
      const list = A().sort((a, b) => a.due - b.due);
      const local = new Date(Date.now() + 7 * DAY - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
      return head('Kelola tugas', 'Buat tugas baru dan pantau jumlah pengumpulan.') + `
        <div class="grid-2">
          <section class="panel"><h2>Tugas baru</h2>
            <form data-form="new-assignment">
              <label>Judul tugas<input name="title" required maxlength="80" placeholder="mis. Laporan praktikum jaringan"></label>
              <label>Mata pelajaran<input name="mapel" required maxlength="40" placeholder="mis. Jaringan Komputer"></label>
              <label>Kelas<input name="kelas" required value="XI RPL 1"></label>
              <label>Tenggat<input type="datetime-local" name="due" required value="${local}"></label>
              <label>Petunjuk<textarea name="desc" maxlength="300" placeholder="Format yang diminta, jumlah halaman, dsb."></textarea></label>
              <button class="btn btn-dark" type="submit">Buat tugas</button>
            </form></section>
          <section class="panel"><h2>Daftar tugas (${list.length})</h2>
            <ul class="list">${list.map(a => { const n = S().filter(s => s.aid === a.id).length; return `<li class="item"><div class="info"><b>${esc(a.title)}</b><small>${esc(a.mapel)} · ${esc(a.kelas)} · ${fmtD(a.due)} (${rel(a.due)})</small></div><div class="acts"><span class="chip muted">${n} pengumpulan</span><button class="btn btn-danger btn-sm" data-act="del-assignment" data-aid="${a.id}">Hapus</button></div></li>`; }).join('') || '<li class="empty">Belum ada tugas.</li>'}</ul></section>
        </div>`;
    },
    berkas() {
      const fa = guruFilter.aid, fs = guruFilter.st;
      let subs = S().filter(s => (!fa || s.aid === fa) && (!fs || (fs === 'nilai' ? s.score != null : s.score == null))).sort((a, b) => b.at - a.at);
      return head('Pengumpulan', 'Buka, unduh, dan nilai tugas dari satu dashboard.', '<button class="btn btn-line btn-sm" data-act="export-csv">Ekspor rekap (CSV)</button>') + `
        <div class="toolbar">
          <label>Tugas<select data-filter="aid"><option value="">Semua tugas</option>${A().map(a => `<option value="${a.id}" ${fa === a.id ? 'selected' : ''}>${esc(a.title)}</option>`).join('')}</select></label>
          <label>Status<select data-filter="st"><option value="">Semua</option><option value="belum" ${fs === 'belum' ? 'selected' : ''}>Perlu dinilai</option><option value="nilai" ${fs === 'nilai' ? 'selected' : ''}>Sudah dinilai</option></select></label>
        </div>
        ${subs.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Siswa</th><th>Tugas</th><th>Berkas / tautan</th><th>Dikirim</th><th>Nilai</th><th></th></tr></thead><tbody>
          ${subs.map(s => { const a = asgById(s.aid); return `<tr>
            <td><b>${esc(userById(s.uid)?.name)}</b><br><small class="muted">${esc(userById(s.uid)?.kelas)}</small></td>
            <td>${esc(a?.title || '–')}</td>
            <td>${esc(s.name)}<br><small class="muted">${s.kind === 'file' ? fmtSize(s.size) : 'Tautan'}${s.note ? ' · ' + esc(s.note) : ''}</small></td>
            <td class="nw">${fmtDT(s.at)}${lateChip(s, a)}</td>
            <td>${s.score != null ? `<span class="chip ok">${s.score}</span>` : '<span class="chip warn">Belum</span>'}</td>
            <td class="nw"><button class="btn btn-line btn-sm" data-act="open-file" data-sid="${s.id}">${s.kind === 'file' ? 'Unduh' : 'Buka'}</button> <button class="btn btn-primary btn-sm" data-act="grade" data-sid="${s.id}">${s.score != null ? 'Ubah nilai' : 'Nilai'}</button></td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="empty">Tidak ada pengumpulan yang cocok dengan filter.</p>'}`;
    },
    bantuan: helpView
  },

  admin: {
    status() {
      const inc = INC().slice().sort((a, b) => b.createdAt - a.createdAt);
      const { uptime, downMin, left } = uptimeCalc();
      const subs = S().filter(s => s.kind === 'file');
      const open = inc.filter(i => !i.closed).length;
      return head('Status sistem', 'Target operasional dan SOP teknis (SOP-TECH-001).') + `
        <div class="stats">
          <div class="stat dark"><b>${nf3.format(Math.round(uptime * 1000) / 1000)}%</b><span>Uptime bulan ini (dari catatan insiden) · target ≥ ${nf.format(UPTIME_TARGET)}%</span></div>
          <div class="stat"><b>${nf.format(Math.max(0, left))} jam</b><span>Sisa toleransi downtime (maks. 3,6 jam/bulan)</span></div>
          <div class="stat"><b>${open}</b><span>Insiden terbuka</span></div>
          <div class="stat"><b>${subs.length}</b><span>Berkas tersimpan · ${fmtSize(subs.reduce((t, s) => t + s.size, 0))}</span></div>
        </div>
        <div class="panel"><h2>Batas operasional</h2>
          <p style="margin:0">Ukuran berkas maksimal <b>25 MB</b> per pengiriman · Penanganan critical bug maksimal <b>1×24 jam</b> sejak dilaporkan · Downtime bulan ini tercatat <b>${Math.round(downMin)} menit</b>.</p></div>
        <div class="panel"><h2>Prosedur penanganan insiden</h2>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tahap</th><th>Prosedur</th><th>Batas waktu</th><th>Kegiatan</th></tr></thead><tbody>
          ${SOP.map((p, i) => `<tr><td>${i + 1}</td><td><b>${p.name}</b></td><td class="nw">${p.limit} menit</td><td>${p.desc}</td></tr>`).join('')}</tbody></table></div></div>
        <div class="grid-2">
          <section class="panel"><h2>Catat insiden baru</h2>
            <form data-form="new-incident">
              <label>Ringkasan kendala<input name="title" required maxlength="100" placeholder="mis. Unggahan gagal di jam sibuk"></label>
              <label>Tingkat<select name="level"><option>Normal</option><option>Critical</option></select></label>
              <button class="btn btn-dark" type="submit">Mulai tahap 1: deteksi</button>
            </form></section>
          <section class="panel"><h2>Catatan insiden (${inc.length})</h2>
            ${inc.map(incHtml).join('') || '<p class="empty">Belum ada insiden tercatat.</p>'}</section>
        </div>`;
    },
    bantuan: helpView
  }
};

let guruFilter = { aid:'', st:'' };

function helpView() {
  const mine = store.get('tickets', []).filter(t => t.uid === me.id).sort((a, b) => b.at - a.at);
  return head('Bantuan', 'Panduan penggunaan dan layanan pelanggan.') + `
    <div class="grid-2">
      <section class="panel"><h2>Pertanyaan umum</h2>${FAQ.map(f => `<details><summary>${esc(f[0])}</summary><div>${esc(f[1])}</div></details>`).join('')}</section>
      <section class="panel"><h2>Hubungi dukungan</h2>
        <form data-form="ticket">
          <label>Topik<select name="topic"><option>Kendala unggah berkas</option><option>Tidak bisa membuka tautan</option><option>Pertanyaan nilai</option><option>Lainnya</option></select></label>
          <label>Ceritakan kendalamu<textarea name="msg" required maxlength="400" placeholder="Apa yang terjadi dan kapan?"></textarea></label>
          <button class="btn btn-dark" type="submit">Kirim ke dukungan</button>
        </form>
        ${mine.length ? `<h3 style="margin-top:1.4rem;font-size:1rem">Tiket kamu</h3><ul class="list">${mine.map(t => `<li class="item"><div class="info"><b>${esc(t.topic)}</b><small>${fmtDT(t.at)} · ${esc(t.msg)}</small></div><span class="chip warn">Diterima</span></li>`).join('')}</ul>` : ''}
      </section>
    </div>`;
}

/* ---------- Insiden & uptime ---------- */
function stageIdx(i) { return i.closed ? 4 : i.stages.length - 1; }
function incHtml(i) {
  const cur = stageIdx(i);
  const stages = SOP.map((p, k) => {
    const st = i.stages[k]; let cls = '', info = 'Menunggu';
    if (st) {
      const end = st.e ?? Date.now(); const m = (end - st.s) / 6e4;
      const over = m > p.limit;
      cls = st.e ? (over ? 'over' : 'done') : 'on';
      info = (st.e ? '' : 'Berjalan · ') + Math.round(m) + ' / ' + p.limit + ' mnt' + (over ? ' (lewat)' : '');
      if (!st.e && over) cls = 'over';
    }
    return `<div class="stage ${cls}"><b>${k + 1}. ${p.name}</b>${info}</div>`;
  }).join('');
  let crit = '';
  if (i.level === 'Critical') {
    const h = ((i.closed ? i.stages[3].e : Date.now()) - i.createdAt) / 36e5;
    crit = h <= 24 ? `<span class="chip ok">≤ 1×24 jam (${nf.format(Math.round(h * 10) / 10)} jam)</span>` : `<span class="chip bad">Lewat 1×24 jam</span>`;
  }
  return `<div class="item" style="display:block;margin-bottom:.7rem">
    <div style="display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap"><b>${esc(i.title)}</b><span>${i.level === 'Critical' ? '<span class="chip bad">Critical</span>' : '<span class="chip muted">Normal</span>'} ${i.closed ? '<span class="chip ok">Selesai</span>' : '<span class="chip warn">Terbuka</span>'} ${crit}</span></div>
    <small class="muted">Dilaporkan ${fmtDT(i.createdAt)}</small>
    <div class="stages">${stages}</div>
    ${i.closed ? '' : `<button class="btn btn-primary btn-sm" data-act="incident-next" data-id="${i.id}">${cur < 3 ? 'Selesaikan tahap ' + (cur + 1) + ' dan lanjut' : 'Selesaikan verifikasi dan tutup insiden'}</button>`}
  </div>`;
}
function uptimeCalc() {
  const m = new Date().getMonth();
  const totalMin = 30 * 1440;                               // basis 30 hari, sesuai toleransi 3,6 jam/bulan
  let down = 0;
  INC().forEach(i => {
    if (new Date(i.createdAt).getMonth() !== m) return;
    i.stages.slice(0, 3).forEach(st => { down += ((st.e ?? Date.now()) - st.s) / 6e4; });
  });
  const tol = totalMin * (1 - UPTIME_TARGET / 100) / 60;   // jam
  return { uptime: 100 - (down / totalMin) * 100, downMin: down, left: Math.round((tol - down / 60) * 10) / 10 };
}

/* ---------- Modal ---------- */
const modal = () => $('#modal');
function openModal(html) { modal().innerHTML = `<div class="modal-in">${html}</div>`; if (!modal().open) modal().showModal(); }
function closeModal() { if (modal().open) modal().close(); }

let pending = null;   // { aid, file, tab }
function submitModal(aid) {
  const a = asgById(aid); if (!a) return;
  const prev = S().find(s => s.aid === aid && s.uid === me.id);
  pending = { aid, file:null, tab:'file' };
  openModal(`
    <button class="x" data-act="close-modal" aria-label="Tutup">×</button>
    <h2>${esc(a.title)}</h2>
    <p class="muted" style="margin:0">${esc(a.mapel)} · Tenggat ${fmtDT(a.due)}${Date.now() > a.due ? ' · sudah lewat, akan ditandai terlambat' : ''}</p>
    ${prev ? `<p class="note" style="margin:1rem 0 0">Kamu sudah mengumpulkan "${esc(prev.name)}". Pengiriman baru akan menggantikannya.</p>` : ''}
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected="true" data-act="tab" data-t="file">Unggah berkas</button>
      <button role="tab" aria-selected="false" data-act="tab" data-t="link">Tempel tautan</button>
    </div>
    <form data-form="submit" novalidate>
      <div id="paneFile">
        <label class="drop" id="drop" for="fileIn"><b>Seret berkas ke sini atau klik untuk memilih</b><small>Maksimal 25 MB · ${ALLOWED.join(', ')}</small></label>
        <input id="fileIn" type="file" hidden>
        <div id="picked"></div>
      </div>
      <div id="paneLink" hidden>
        <label>Alamat tautan<input name="url" type="url" placeholder="https://..."></label>
        <label>Nama tautan<input name="lname" maxlength="80" placeholder="mis. Repositori kelompok"></label>
      </div>
      <label>Catatan untuk guru (opsional)<textarea name="note" maxlength="200"></textarea></label>
      <div class="progress" id="prog" hidden><div class="bar"><i style="width:0"></i></div><small></small></div>
      <p class="form-error" id="subErr" role="alert" hidden></p>
      <div class="modal-foot"><button type="button" class="btn btn-line" data-act="close-modal">Batal</button><button class="btn btn-primary" type="submit" id="subBtn">Kumpulkan tugas</button></div>
    </form>`);
}
function validateFile(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (f.size > MAX_BYTES) return `Berkas ${fmtSize(f.size)} melebihi batas 25 MB. Kompres berkas atau kirim lewat tab Tautan.`;
  if (f.size === 0) return 'Berkas kosong. Pilih berkas lain.';
  if (!ALLOWED.includes(ext)) return `Jenis ".${ext}" tidak diterima. Gunakan: ${ALLOWED.join(', ')}.`;
  return '';
}
function pickFile(f) {
  const err = validateFile(f), box = $('#subErr');
  if (err) { pending.file = null; $('#picked').innerHTML = ''; box.textContent = err; box.hidden = false; return; }
  box.hidden = true; pending.file = f;
  $('#picked').innerHTML = `<div class="picked"><span><b>${esc(f.name)}</b> · ${fmtSize(f.size)}</span><span>Siap dikirim</span></div>`;
}
async function doSubmit(form) {
  const err = $('#subErr'); err.hidden = true;
  const a = asgById(pending.aid); const note = form.note.value.trim();
  let sub = { id:uid('p'), aid:pending.aid, uid:me.id, note, at:Date.now(), score:null, feedback:'' };
  const prog = $('#prog'), bar = $('#prog i'), msg = $('#prog small');
  const step = async (w, t) => { prog.hidden = false; bar.style.width = w + '%'; msg.textContent = t; await sleep(280); };
  if (pending.tab === 'file') {
    if (!pending.file) { err.textContent = 'Pilih berkas terlebih dahulu.'; err.hidden = false; return; }
    $('#subBtn').disabled = true;
    try {
      await step(25, 'Memeriksa ukuran dan jenis berkas…');
      await step(55, 'Mengenkripsi berkas…');
      sub.encrypted = await saveFile(sub.id, pending.file);
      await step(90, 'Menyimpan ke penyimpanan…');
    } catch (e) { err.textContent = 'Gagal menyimpan berkas. Coba lagi.'; err.hidden = false; $('#subBtn').disabled = false; return; }
    Object.assign(sub, { kind:'file', name:pending.file.name, size:pending.file.size });
  } else {
    const url = form.url.value.trim();
    let ok = false; try { ok = /^https?:$/.test(new URL(url).protocol); } catch {}
    if (!ok) { err.textContent = 'Tautan tidak valid. Awali dengan http:// atau https://'; err.hidden = false; return; }
    await step(60, 'Memeriksa tautan…');
    Object.assign(sub, { kind:'link', url, name: form.lname.value.trim() || url });
  }
  await step(100, 'Selesai');
  const list = S(); const old = list.find(s => s.aid === sub.aid && s.uid === me.id);
  if (old) { if (old.kind === 'file') idb.del(old.id).catch(() => {}); list.splice(list.indexOf(old), 1); }
  list.push(sub); store.set('subs', list);
  closeModal(); toast(`Tugas "${a.title}" berhasil dikumpulkan.` + (sub.at > a.due ? ' Ditandai terlambat.' : ''), 'ok');
  renderApp();
}
function gradeModal(sid) {
  const s = S().find(x => x.id === sid); if (!s) return;
  openModal(`<button class="x" data-act="close-modal" aria-label="Tutup">×</button>
    <h2>Beri nilai</h2><p class="muted">${esc(userById(s.uid)?.name)} · ${esc(asgById(s.aid)?.title)}</p>
    <form data-form="grade" data-sid="${sid}">
      <label>Nilai (0–100)<input name="score" type="number" min="0" max="100" required value="${s.score ?? ''}"></label>
      <label>Umpan balik<textarea name="fb" maxlength="300">${esc(s.feedback)}</textarea></label>
      <div class="modal-foot"><button type="button" class="btn btn-line" data-act="close-modal">Batal</button><button class="btn btn-primary" type="submit">Simpan nilai</button></div></form>`);
}

/* ---------- Pendaftaran akun ---------- */
function registerModal() {
  openModal(`<button class="x" data-act="close-modal" aria-label="Tutup">×</button>
    <h2>Buat akun baru</h2><p class="muted">Akun tersimpan di cloud dan bisa dipakai masuk dari device mana pun.</p>
    <form data-form="register" autocomplete="off" novalidate>
      <label>Nama lengkap<input name="name" maxlength="50" required></label>
      <label>Peran<select name="role"><option value="siswa">Siswa</option><option value="guru">Guru</option></select></label>
      <label id="kelasRow">Kelas<input name="kelas" maxlength="20" placeholder="mis. XI RPL 1"></label>
      <label>Nama pengguna<input name="username" maxlength="20" autocomplete="off" required></label>
      <label>Kata sandi<input name="password" type="password" autocomplete="new-password" required></label>
      <label>Ulangi kata sandi<input name="password2" type="password" autocomplete="new-password" required></label>
      <p class="form-error" id="regErr" role="alert" hidden></p>
      <div class="modal-foot"><button type="button" class="btn btn-line" data-act="close-modal">Batal</button><button class="btn btn-primary" type="submit">Daftar</button></div>
    </form>`);
}
function register(f) {
  const err = $('#regErr'); const fail = m => { err.textContent = m; err.hidden = false; };
  const name = f.name.value.trim(), username = f.username.value.trim().toLowerCase();
  const role = f.role.value, password = f.password.value;
  const kelas = role === 'siswa' ? normKelas(f.kelas.value) : '';
  if (name.length < 3) return fail('Nama lengkap minimal 3 karakter.');
  if (role === 'siswa' && !kelas) return fail('Isi kelas.');
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) return fail('Nama pengguna 3–20 karakter: huruf kecil, angka, titik, atau garis bawah.');
  if (USERS.some(u => u.username === username)) return fail('Nama pengguna sudah dipakai.');
  if (password.length < 6) return fail('Kata sandi minimal 6 karakter.');
  if (password !== f.password2.value) return fail('Konfirmasi kata sandi tidak sama.');
  const u = { id: uid('u'), username, password, role, name, kelas };
  USERS.push(u);
  store.set('users', store.get('users', []).concat(u));
  closeModal(); toast('Akun dibuat. Selamat datang!', 'ok');
  login(username, password);
}

/* ---------- Aksi ---------- */
async function openOrDownload(sid) {
  const s = S().find(x => x.id === sid); if (!s) return;
  if (s.kind === 'link') { window.open(s.url, '_blank', 'noopener'); return; }
  try {
    const blob = await loadFile(s.id);
    if (!blob) { toast('Berkas tidak ditemukan di penyimpanan.', 'error'); return; }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href:url, download:s.name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch { toast('Gagal membuka berkas.', 'error'); }
}
function exportCsv() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['Siswa','Kelas','Tugas','Mapel','Berkas/Tautan','Dikirim','Terlambat','Nilai','Umpan balik']];
  S().forEach(s => { const a = asgById(s.aid), u = userById(s.uid); rows.push([u?.name, u?.kelas, a?.title, a?.mapel, s.name, fmtDT(s.at), a && s.at > a.due ? 'Ya' : 'Tidak', s.score ?? '', s.feedback]); });
  const blob = new Blob(['\ufeff' + rows.map(r => r.map(q).join(',')).join('\n')], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href:url, download:'rekap-pengumpulan.csv' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
  toast('Rekap CSV diunduh.', 'ok');
}
function login(username, password) {
  const u = USERS.find(x => x.username === username.trim().toLowerCase() && x.password === password);
  const err = $('#loginError');
  if (!u) { err.textContent = 'Nama pengguna atau kata sandi salah. Coba akun demo di bawah.'; err.hidden = false; return; }
  err.hidden = true; session.set(u.username); location.hash = '#/app';
  if (location.hash === '#/app') route();
}

const ACTIONS = {
  'toggle-nav'(el) { const n = $('#nav'); const o = n.classList.toggle('open'); el.setAttribute('aria-expanded', o); },
  'copy-demo'() { navigator.clipboard?.writeText('https://' + $('#demoLink').textContent).then(() => toast('Tautan contoh disalin.', 'ok'), () => toast('Tidak bisa menyalin otomatis.', 'error')); },
  'login-demo'(el) { const u = USERS.find(x => x.username === el.dataset.u); const f = $('#loginForm'); f.username.value = u.username; f.password.value = u.password; login(u.username, u.password); },
  'open-register'() { registerModal(); },
  logout() { session.clear(); closeModal(); location.hash = '#/'; route(); },
  nav(el) { $('#side')?.classList.remove('open'); location.hash = '#/app/' + el.dataset.v; },
  'toggle-side'() { $('#side').classList.toggle('open'); },
  'close-modal'() { closeModal(); },
  'open-submit'(el) { submitModal(el.dataset.aid); },
  tab(el) {
    pending.tab = el.dataset.t;
    $$('.tabs button').forEach(b => b.setAttribute('aria-selected', b === el));
    $('#paneFile').hidden = pending.tab !== 'file'; $('#paneLink').hidden = pending.tab !== 'link'; $('#subErr').hidden = true;
  },
  'open-file'(el) { openOrDownload(el.dataset.sid); },
  'del-sub'(el) {
    const list = S(); const s = list.find(x => x.id === el.dataset.sid); if (!s) return;
    if (!confirm('Hapus pengiriman "' + s.name + '"?')) return;
    if (s.kind === 'file') idb.del(s.id).catch(() => {});
    store.set('subs', list.filter(x => x.id !== s.id)); toast('Pengiriman dihapus.'); renderApp();
  },
  'del-assignment'(el) {
    const a = asgById(el.dataset.aid); if (!a || !confirm('Hapus tugas "' + a.title + '" beserta semua pengumpulannya?')) return;
    S().filter(s => s.aid === a.id && s.kind === 'file').forEach(s => idb.del(s.id).catch(() => {}));
    store.set('subs', S().filter(s => s.aid !== a.id)); store.set('assignments', A().filter(x => x.id !== a.id));
    toast('Tugas dihapus.'); renderApp();
  },
  grade(el) { gradeModal(el.dataset.sid); },
  'export-csv'() { exportCsv(); },
  'incident-next'(el) {
    const list = INC(); const i = list.find(x => x.id === el.dataset.id); if (!i) return;
    const now = Date.now(); const k = i.stages.length - 1;
    i.stages[k].e = now;
    if (k < 3) i.stages.push({ s:now, e:null }); else i.closed = true;
    store.set('incidents', list); toast(i.closed ? 'Insiden ditutup dan laporan dicatat.' : 'Lanjut ke tahap ' + (k + 2) + ': ' + SOP[k + 1].name, 'ok'); renderApp();
  },
  'reset-demo'() {
    if (!confirm('Kembalikan data tugas dan pengumpulan ke kondisi awal? Berkas yang diunggah akan terhapus. Akun yang sudah dibuat tetap tersimpan.')) return;
    const keep = session.get();
    Object.keys(localStorage).filter(k => k.startsWith('clt.') && k !== 'clt.users').forEach(k => localStorage.removeItem(k));
    idb.clear().catch(() => {}); seed(); session.set(keep); toast('Data demo diatur ulang.', 'ok'); renderApp();
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && ACTIONS[el.dataset.act]) { if (el.tagName === 'A') e.preventDefault(); ACTIONS[el.dataset.act](el); return; }
  if (e.target === modal()) closeModal();                       // klik latar modal
  if (e.target.closest('#nav a')) $('#nav').classList.remove('open');
});

document.addEventListener('submit', e => {
  const f = e.target; e.preventDefault();
  if (f.id === 'loginForm') return login(f.username.value, f.password.value);
  switch (f.dataset.form) {
    case 'register': return register(f);
    case 'submit': return doSubmit(f);
    case 'grade': {
      const n = Number(f.score.value);
      if (!Number.isFinite(n) || n < 0 || n > 100) return toast('Nilai harus antara 0 dan 100.', 'error');
      const list = S(); const s = list.find(x => x.id === f.dataset.sid);
      s.score = Math.round(n); s.feedback = f.fb.value.trim(); store.set('subs', list);
      closeModal(); toast('Nilai disimpan.', 'ok'); return renderApp();
    }
    case 'new-assignment': {
      const due = new Date(f.due.value).getTime();
      if (!due) return toast('Isi tenggat dengan benar.', 'error');
      const list = A(); list.push({ id:uid('a'), title:f.title.value.trim(), mapel:f.mapel.value.trim(), kelas:normKelas(f.kelas.value), due, desc:f.desc.value.trim() || 'Ikuti petunjuk guru.' });
      store.set('assignments', list); toast('Tugas dibuat.', 'ok'); return renderApp();
    }
    case 'new-incident': {
      const list = INC(); const now = Date.now();
      list.push({ id:uid('i'), title:f.title.value.trim(), level:f.level.value, createdAt:now, closed:false, stages:[{ s:now, e:null }] });
      store.set('incidents', list); toast('Insiden dicatat. Tahap 1 dimulai.', 'ok'); return renderApp();
    }
    case 'ticket': {
      const list = store.get('tickets', []); list.push({ id:uid('t'), uid:me.id, topic:f.topic.value, msg:f.msg.value.trim(), at:Date.now() });
      store.set('tickets', list); toast('Pesan terkirim ke dukungan.', 'ok'); return renderApp();
    }
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fileIn' && t.files[0]) pickFile(t.files[0]);
  if (t.dataset.filter) { guruFilter[t.dataset.filter] = t.value; renderApp(); }
  if (t.name === 'role' && t.closest('[data-form="register"]')) $('#kelasRow').hidden = t.value !== 'siswa';
});
document.addEventListener('dragover', e => { const d = e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', e => { const d = e.target.closest('#drop'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', e => {
  const d = e.target.closest('#drop'); if (!d) return;
  e.preventDefault(); d.classList.remove('over');
  if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]);
});

window.addEventListener('hashchange', route);
(async function boot() {
  await cloudPull();      // ambil data terbaru dari cloud
  mergeUsers();           // muat akun yang sudah terdaftar
  seed();
  route();
  cloudListen();          // tugas/akun baru dari device lain langsung muncul
})();