'use strict';
/* Biofit — servidor com banco de dados SQLite. Não precisa instalar nada além do Node.js 22.13+. */
if (!process.env.TZ) process.env.TZ = 'America/Sao_Paulo';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), os = require('node:os');

const _ew = process.emitWarning;
process.emitWarning = (w, ...a) => { if (String(w && w.message || w).includes('SQLite')) return; return _ew.call(process, w, ...a); };
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) {
  console.error(`\nO Biofit precisa do Node.js 22.13 ou mais recente (você tem ${process.version}).\nBaixe a versão LTS em https://nodejs.org e tente de novo.\n`);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'dados'));
const MID = path.join(DATA, 'midia');
const PUB = path.join(__dirname, 'public');
const TRUST_PROXY = /^(1|true|sim)$/i.test(process.env.TRUST_PROXY || '');
/* Arquivos públicos do app (PWA). Só estes podem ser servidos. */
const ESTATICOS = {
  '/': ['index.html', 'text/html; charset=utf-8', 'no-cache'],
  '/index.html': ['index.html', 'text/html; charset=utf-8', 'no-cache'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8', 'no-cache'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8', 'no-cache'],
  '/favicon.ico': ['icons/favicon-64.png', 'image/png', 'public, max-age=604800'],
  '/icons/icon-192.png': ['icons/icon-192.png', 'image/png', 'public, max-age=604800'],
  '/icons/icon-512.png': ['icons/icon-512.png', 'image/png', 'public, max-age=604800'],
  '/icons/maskable-512.png': ['icons/maskable-512.png', 'image/png', 'public, max-age=604800'],
  '/icons/apple-touch-icon.png': ['icons/apple-touch-icon.png', 'image/png', 'public, max-age=604800'],
  '/apple-touch-icon.png': ['icons/apple-touch-icon.png', 'image/png', 'public, max-age=604800'],
  '/icons/favicon-64.png': ['icons/favicon-64.png', 'image/png', 'public, max-age=604800'],
};
const ipDe = req => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
const httpsDe = req => req.socket.encrypted || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
fs.mkdirSync(MID, { recursive: true });

/* ---------- banco ---------- */
const sql = new DatabaseSync(path.join(DATA, 'biofit.db'));
sql.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY CHECK(id=1), email TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS planos(id INTEGER PRIMARY KEY, nome TEXT NOT NULL, valor REAL NOT NULL, meses INTEGER NOT NULL, freq INTEGER NOT NULL DEFAULT 3);
CREATE TABLE IF NOT EXISTS treinos(id INTEGER PRIMARY KEY, nome TEXT NOT NULL, ex TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS alunos(id INTEGER PRIMARY KEY, nome TEXT NOT NULL, cpf TEXT NOT NULL UNIQUE, telefone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  plano_id INTEGER REFERENCES planos(id), inicio TEXT NOT NULL, venc TEXT, status TEXT NOT NULL DEFAULT 'ATIVO', login TEXT UNIQUE, hash TEXT, rotina TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS pagamentos(id INTEGER PRIMARY KEY, aluno_id INTEGER NOT NULL REFERENCES alunos(id) ON DELETE CASCADE, valor REAL NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PAGO');
CREATE TABLE IF NOT EXISTS envios(id INTEGER PRIMARY KEY, aluno_id INTEGER NOT NULL REFERENCES alunos(id) ON DELETE CASCADE, data TEXT NOT NULL, treino_id INTEGER,
  arquivo TEXT NOT NULL, tipo TEXT NOT NULL, mime TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDENTE', ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessoes(token TEXT PRIMARY KEY, papel TEXT NOT NULL, aluno_id INTEGER, expira INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_pag_aluno ON pagamentos(aluno_id);
CREATE INDEX IF NOT EXISTS ix_env_aluno ON envios(aluno_id, data);
`);
/* migração: o pagamento guarda o plano vigente na cobrança */
if (!sql.prepare('PRAGMA table_info(pagamentos)').all().some(c => c.name === 'plano_id')) sql.exec('ALTER TABLE pagamentos ADD COLUMN plano_id INTEGER');
const all = (s, ...p) => sql.prepare(s).all(...p);
const one = (s, ...p) => sql.prepare(s).get(...p);
const run = (s, ...p) => sql.prepare(s).run(...p);
function tx(fn) { sql.exec('BEGIN'); try { const r = fn(); sql.exec('COMMIT'); return r; } catch (e) { sql.exec('ROLLBACK'); throw e; } }

if (!one('SELECT 1 x FROM admin') && one('SELECT COUNT(*) n FROM planos').n === 0) {
  run("INSERT INTO planos(nome,valor,meses,freq) VALUES('Mensal',120,1,3),('Trimestral',300,3,3),('Anual',1000,12,3)");
}
if (!one('SELECT 1 x FROM admin') && one('SELECT COUNT(*) n FROM treinos').n === 0) {
  const T = (nome, ex) => run('INSERT INTO treinos(nome,ex) VALUES(?,?)', nome, JSON.stringify(ex));
  T('Treino A', [{ n: 'Agachamento', s: '3x12', a: 'agachamento' }, { n: 'Flexão de braço', s: '3x10', a: 'flexao' }]);
  T('Treino B', [{ n: 'Afundo', s: '3x10 por perna', a: 'afundo' }, { n: 'Prancha', s: '3x30 s', a: 'prancha' }]);
  T('Treino C', [{ n: 'Polichinelo', s: '3x30 s', a: 'polichinelo' }, { n: 'Abdominal', s: '3x15', a: 'abdominal' }]);
}

/* ---------- utilidades ---------- */
const E = (st, msg) => Object.assign(new Error(msg), { st });
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const parse = s => new Date(s + 'T00:00:00');
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parse(s)) && iso(parse(s)) === s;
function addM(s, n) { const d = parse(s), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); return iso(d); }
function week() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return [0, 1, 2, 3, 4, 5, 6].map(i => { const x = new Date(d); x.setDate(d.getDate() + i); return iso(x); }); }
const PAT = { 1: [3], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 0] };
function slot(a, date) {
  const p = one('SELECT * FROM planos WHERE id=?', a.plano_id); if (!p) return null;
  const days = PAT[Math.min(7, Math.max(1, p.freq || 3))], i = days.indexOf(parse(date).getDay()); if (i < 0) return null;
  const r = JSON.parse(a.rotina || '[]'); return { t: r.length ? r[i % r.length] : null };
}
const txt = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const intIn = (v, a, b, msg) => { const n = num(v); if (!Number.isInteger(n) || n < a || n > b) throw E(400, msg); return n; };
function fmtCpf(v) { const d = String(v ?? '').replace(/\D/g, ''); if (d.length !== 11) throw E(400, 'CPF deve ter 11 dígitos.'); return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'); }
const emailOk = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/* ---------- exercícios e animações ---------- */
const ANIMS = new Set(['agachamento', 'flexao', 'afundo', 'prancha', 'polichinelo', 'abdominal']);
function guessAnim(nome) {
  const s = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /agach/.test(s) ? 'agachamento' : /flex/.test(s) ? 'flexao' : /afund/.test(s) ? 'afundo' : /prancha/.test(s) ? 'prancha' : /polich/.test(s) ? 'polichinelo' : /abdom|crunch/.test(s) ? 'abdominal' : '';
}
/* aceita a lista nova (objetos) e a antiga (um exercício por texto) */
function normEx(lista) {
  return (Array.isArray(lista) ? lista : String(lista ?? '').split('\n')).map(x => {
    if (x && typeof x === 'object') { const n = txt(x.n, 120); return n && { n, s: txt(x.s, 60), a: ANIMS.has(x.a) ? x.a : '' }; }
    const n = txt(x, 200); return n && { n, s: '', a: guessAnim(n) };
  }).filter(Boolean).slice(0, 100);
}
for (const t of all('SELECT id,ex FROM treinos')) {
  const e = JSON.parse(t.ex);
  if (e.some(x => typeof x === 'string')) run('UPDATE treinos SET ex=? WHERE id=?', JSON.stringify(normEx(e)), t.id);
}

/* ---------- senhas e sessões ---------- */
function hashPw(pw) { const s = crypto.randomBytes(16); return 'scrypt:' + s.toString('hex') + ':' + crypto.scryptSync(pw, s, 32).toString('hex'); }
function checkPw(stored, pw, legacySalt) {
  if (!stored || typeof pw !== 'string') return false;
  if (stored.startsWith('scrypt:')) {
    const [, s, h] = stored.split(':'), a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 32), b = Buffer.from(h, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (stored.startsWith('sha256:')) { // senhas vindas do backup da versão antiga
    const a = Buffer.from(crypto.createHash('sha256').update(legacySalt + ':' + pw).digest('hex')), b = Buffer.from(stored.slice(7));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return false;
}
const DIA = 864e5;
const cookie = (req, v, maxAge) => `sid=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${httpsDe(req) ? '; Secure' : ''}`;
function criarSessao(req, res, papel, alunoId = null) {
  const t = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessoes(token,papel,aluno_id,expira) VALUES(?,?,?,?)', t, papel, alunoId, Date.now() + 30 * DIA);
  res.setHeader('Set-Cookie', cookie(req, t, 30 * 86400));
}
function sessao(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || ''); if (!m) return null;
  const s = one('SELECT * FROM sessoes WHERE token=?', m[1]); if (!s || s.expira < Date.now()) return null;
  if (s.papel === 'aluno') { const a = one('SELECT status FROM alunos WHERE id=?', s.aluno_id); if (!a || a.status !== 'ATIVO') return null; }
  return s;
}
const limpar = () => run('DELETE FROM sessoes WHERE expira<?', Date.now());
limpar(); setInterval(limpar, DIA).unref();

const falhas = new Map(), JANELA = 15 * 60e3;
function limite(req) { const f = falhas.get(ipDe(req)); if (f && f.n >= 10 && Date.now() - f.t < JANELA) throw E(429, 'Muitas tentativas. Aguarde 15 minutos.'); }
function falhou(req) { const ip = ipDe(req), f = falhas.get(ip); if (!f || Date.now() - f.t > JANELA) falhas.set(ip, { n: 1, t: Date.now() }); else f.n++; }

/* ---------- http ---------- */
function corpo(req, max) {
  return new Promise((ok, no) => {
    const parts = []; let n = 0, over = false;
    req.on('data', c => { n += c.length; if (n > max) over = true; else parts.push(c); });
    req.on('end', () => over ? no(E(413, 'Arquivo ou dados grandes demais.')) : ok(Buffer.concat(parts)));
    req.on('error', no);
  });
}
async function json(req) {
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) throw E(415, 'Formato inválido.');
  const b = await corpo(req, 20 * 2 ** 20);
  try { const j = JSON.parse(b.toString('utf8') || '{}'); if (!j || typeof j !== 'object') throw 0; return j; } catch (e) { throw E(400, 'Dados inválidos.'); }
}
const SEG = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function enviar(res, st, obj) { const b = JSON.stringify(obj); res.writeHead(st, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEG }); res.end(b); }
function enviarArquivo(req, res, file, mime) {
  let st; try { st = fs.statSync(file); } catch { throw E(404, 'Arquivo não encontrado.'); }
  const h = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400', 'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    let a, b;
    if (m[1]) { a = +m[1]; b = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1; } else { a = Math.max(0, st.size - +m[2]); b = st.size - 1; }
    if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
    fs.createReadStream(file, { start: a, end: b }).pipe(res);
  } else { res.writeHead(200, { ...h, 'Content-Length': st.size }); fs.createReadStream(file).pipe(res); }
}

/* ---------- formatos devolvidos ---------- */
const fPlano = r => r && { id: r.id, nome: r.nome, valor: r.valor, meses: r.meses, freq: r.freq };
const fTreino = r => ({ id: r.id, nome: r.nome, ex: normEx(JSON.parse(r.ex)) });
const fAluno = r => ({ id: r.id, nome: r.nome, cpf: r.cpf, telefone: r.telefone, email: r.email, planoId: r.plano_id, inicio: r.inicio, venc: r.venc, status: r.status, login: r.login || '', temSenha: !!r.hash, rotina: JSON.parse(r.rotina) });
const fPag = r => ({ id: r.id, alunoId: r.aluno_id, planoId: r.plano_id ?? null, valor: r.valor, data: r.data, status: r.status });
const fEnvio = r => ({ id: r.id, alunoId: r.aluno_id, data: r.data, treinoId: r.treino_id, tipo: r.tipo, status: r.status, ts: r.ts });

/* ---------- rotas ---------- */
const rotas = [];
const rota = (m, p, papel, fn) => rotas.push({ m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>\\d+)') + '$'), papel, fn });

rota('GET', '/api/saude', null, () => { one('SELECT 1 x'); return { ok: true }; });
rota('GET', '/api/status', null, ({ s }) => ({ temAdmin: !!one('SELECT 1 x FROM admin'), me: s ? { papel: s.papel } : null }));

rota('POST', '/api/admin/criar', null, async ({ req, res }) => {
  const b = await json(req), email = txt(b.email, 120).toLowerCase(), senha = String(b.senha ?? '');
  if (!emailOk(email)) throw E(400, 'Informe um e-mail válido.');
  if (senha.length < 6) throw E(400, 'A senha precisa ter 6 ou mais caracteres.');
  tx(() => { if (one('SELECT 1 x FROM admin')) throw E(409, 'O administrador já foi criado. Faça login.'); run('INSERT INTO admin(id,email,hash) VALUES(1,?,?)', email, hashPw(senha)); });
  criarSessao(req, res, 'admin');
});

rota('POST', '/api/login', null, async ({ req, res }) => {
  limite(req);
  const b = await json(req), email = txt(b.email, 120).toLowerCase(), senha = String(b.senha ?? ''), a = one('SELECT * FROM admin WHERE id=1');
  if (!a || a.email !== email || !checkPw(a.hash, senha, a.email)) { falhou(req); throw E(401, 'E-mail ou senha inválidos.'); }
  if (!a.hash.startsWith('scrypt:')) run('UPDATE admin SET hash=? WHERE id=1', hashPw(senha));
  criarSessao(req, res, 'admin');
});

rota('POST', '/api/aluno/login', null, async ({ req, res }) => {
  limite(req);
  const b = await json(req), login = txt(b.login, 60).toLowerCase(), senha = String(b.senha ?? '');
  const a = login ? one('SELECT * FROM alunos WHERE login=?', login) : null;
  if (!a || !checkPw(a.hash, senha, String(a.id))) { falhou(req); throw E(401, 'Usuário ou senha inválidos.'); }
  if (a.status !== 'ATIVO') throw E(403, 'Cadastro inativo. Fale com a recepção.');
  if (!a.hash.startsWith('scrypt:')) run('UPDATE alunos SET hash=? WHERE id=?', hashPw(senha), a.id);
  criarSessao(req, res, 'aluno', a.id);
});

rota('POST', '/api/logout', null, ({ req, res }) => {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || ''); if (m) run('DELETE FROM sessoes WHERE token=?', m[1]);
  res.setHeader('Set-Cookie', cookie(req, '', 0));
});

rota('GET', '/api/data', 'admin', () => ({
  planos: all('SELECT * FROM planos ORDER BY id').map(fPlano),
  alunos: all('SELECT * FROM alunos ORDER BY id').map(fAluno),
  pagamentos: all('SELECT * FROM pagamentos ORDER BY id').map(fPag),
  treinos: all('SELECT * FROM treinos ORDER BY id').map(fTreino),
  envios: all('SELECT * FROM envios ORDER BY id').map(fEnvio),
}));

/* planos */
function lerPlano(b) {
  const nome = txt(b.nome, 120); if (!nome) throw E(400, 'Informe o nome do plano.');
  const valor = num(b.valor); if (!(valor > 0)) throw E(400, 'Informe um valor maior que zero.');
  return [nome, Math.round(valor * 100) / 100, intIn(b.meses, 1, 36, 'Duração deve ser de 1 a 36 meses.'), intIn(b.freq, 1, 7, 'Treinos por semana devem ser de 1 a 7.')];
}
rota('POST', '/api/planos', 'admin', async ({ req }) => { run('INSERT INTO planos(nome,valor,meses,freq) VALUES(?,?,?,?)', ...lerPlano(await json(req))); });
rota('PUT', '/api/planos/:id', 'admin', async ({ req, p }) => { const v = lerPlano(await json(req)); if (!run('UPDATE planos SET nome=?,valor=?,meses=?,freq=? WHERE id=?', ...v, +p.id).changes) throw E(404, 'Plano não encontrado.'); });
rota('DELETE', '/api/planos/:id', 'admin', ({ p }) => {
  const u = one('SELECT COUNT(*) n FROM alunos WHERE plano_id=?', +p.id).n;
  if (u) throw E(409, `Plano em uso por ${u} aluno(s). Mude o plano deles antes.`);
  run('DELETE FROM planos WHERE id=?', +p.id);
});

/* treinos */
function lerTreino(b) {
  const nome = txt(b.nome, 120); if (!nome) throw E(400, 'Informe o nome do treino.');
  const ex = normEx(b.ex); if (!ex.length) throw E(400, 'Adicione ao menos um exercício.');
  return [nome, JSON.stringify(ex)];
}
rota('POST', '/api/treinos', 'admin', async ({ req }) => { run('INSERT INTO treinos(nome,ex) VALUES(?,?)', ...lerTreino(await json(req))); });
rota('PUT', '/api/treinos/:id', 'admin', async ({ req, p }) => { const v = lerTreino(await json(req)); if (!run('UPDATE treinos SET nome=?,ex=? WHERE id=?', ...v, +p.id).changes) throw E(404, 'Treino não encontrado.'); });
rota('DELETE', '/api/treinos/:id', 'admin', ({ p }) => tx(() => {
  const id = +p.id;
  for (const a of all('SELECT id,rotina FROM alunos')) { const r = JSON.parse(a.rotina); if (r.includes(id)) run('UPDATE alunos SET rotina=? WHERE id=?', JSON.stringify(r.filter(x => x !== id)), a.id); }
  run('DELETE FROM treinos WHERE id=?', id);
}));

/* alunos */
function salvarAluno(id, b) {
  const atual = id ? one('SELECT * FROM alunos WHERE id=?', id) : null; if (id && !atual) throw E(404, 'Aluno não encontrado.');
  const nome = txt(b.nome, 120); if (!nome) throw E(400, 'Informe o nome.');
  const cpf = fmtCpf(b.cpf);
  if (one('SELECT 1 x FROM alunos WHERE cpf=? AND id<>?', cpf, id || 0)) throw E(409, 'CPF já cadastrado.');
  const p = one('SELECT * FROM planos WHERE id=?', num(b.planoId)); if (!p) throw E(400, 'Escolha um plano válido.');
  const inicio = b.inicio; if (!isDate(inicio)) throw E(400, 'Data de início inválida.');
  const status = b.status === 'INATIVO' ? 'INATIVO' : 'ATIVO';
  const login = txt(b.login, 60).toLowerCase() || null;
  if (login && one('SELECT 1 x FROM alunos WHERE login=? AND id<>?', login, id || 0)) throw E(409, 'Este usuário já existe.');
  const senha = String(b.senha ?? '');
  if (senha && senha.length < 6) throw E(400, 'A senha precisa ter 6 ou mais caracteres.');
  if (login && !senha && !atual?.hash) throw E(400, 'Defina uma senha com 6 ou mais caracteres.');
  const ids = new Set(all('SELECT id FROM treinos').map(r => r.id));
  const rotina = [...new Set((Array.isArray(b.rotina) ? b.rotina : []).map(Number))].filter(x => ids.has(x));
  const mudou = !atual || atual.plano_id !== p.id || atual.inicio !== inicio;
  const venc = mudou ? addM(inicio, p.meses) : atual.venc;
  const hash = senha ? hashPw(senha) : (atual?.hash ?? null);
  const v = [nome, cpf, txt(b.telefone, 40), txt(b.email, 120), p.id, inicio, venc, status, login, hash, JSON.stringify(rotina)];
  if (atual) {
    run('UPDATE alunos SET nome=?,cpf=?,telefone=?,email=?,plano_id=?,inicio=?,venc=?,status=?,login=?,hash=?,rotina=? WHERE id=?', ...v, id);
    if (senha || status === 'INATIVO' || login !== atual.login) run("DELETE FROM sessoes WHERE papel='aluno' AND aluno_id=?", id);
  } else run('INSERT INTO alunos(nome,cpf,telefone,email,plano_id,inicio,venc,status,login,hash,rotina) VALUES(?,?,?,?,?,?,?,?,?,?,?)', ...v);
}
rota('POST', '/api/alunos', 'admin', async ({ req }) => { salvarAluno(null, await json(req)); });
rota('PUT', '/api/alunos/:id', 'admin', async ({ req, p }) => { salvarAluno(+p.id, await json(req)); });
rota('DELETE', '/api/alunos/:id', 'admin', ({ p }) => {
  const id = +p.id, arqs = all('SELECT arquivo FROM envios WHERE aluno_id=?', id).map(r => r.arquivo);
  tx(() => { run("DELETE FROM sessoes WHERE papel='aluno' AND aluno_id=?", id); run('DELETE FROM alunos WHERE id=?', id); });
  arqs.forEach(f => fs.rm(path.join(MID, f), { force: true }, () => {}));
});

/* pagamentos */
rota('POST', '/api/pagamentos', 'admin', async ({ req }) => {
  const b = await json(req), valor = num(b.valor); if (!(valor > 0)) throw E(400, 'Informe um valor maior que zero.');
  tx(() => {
    const a = one('SELECT * FROM alunos WHERE id=?', num(b.alunoId)); if (!a) throw E(404, 'Aluno não encontrado.');
    const p = one('SELECT * FROM planos WHERE id=?', a.plano_id); if (!p) throw E(400, 'Aluno sem plano.');
    const h = today(), base = a.venc && a.venc >= h ? a.venc : h;
    run('UPDATE alunos SET venc=? WHERE id=?', addM(base, p.meses), a.id);
    run("INSERT INTO pagamentos(aluno_id,plano_id,valor,data,status) VALUES(?,?,?,?,'PAGO')", a.id, p.id, Math.round(valor * 100) / 100, h);
  });
});

/* envios e validação */
rota('POST', '/api/envios/:id/revisar', 'admin', async ({ req, p }) => {
  const b = await json(req);
  if (!run('UPDATE envios SET status=? WHERE id=?', b.aprovado ? 'APROVADO' : 'REJEITADO', +p.id).changes) throw E(404, 'Envio não encontrado.');
});
const MIME_OK = /^(image\/(jpeg|png|webp|gif|heic|heif)|video\/[a-z0-9.+-]+)$/;
rota('POST', '/api/envios', 'aluno', async ({ req, url, s }) => {
  const a = one('SELECT * FROM alunos WHERE id=?', s.aluno_id), h = today();
  if (!a.venc || a.venc < h) throw E(403, 'Seu plano venceu. Procure a recepção para renovar.');
  const d = url.searchParams.get('data');
  if (!isDate(d) || d > h || !week().includes(d)) throw E(400, 'Só é possível enviar treinos desta semana até hoje.');
  if (d < a.inicio) throw E(400, 'Esta data é anterior ao início do seu plano.');
  const sl = slot(a, d); if (!sl) throw E(400, 'Não há treino neste dia.');
  if (all('SELECT status FROM envios WHERE aluno_id=? AND data=?', a.id, d).some(e => e.status !== 'REJEITADO')) throw E(409, 'Este dia já tem um envio.');
  const mime = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!MIME_OK.test(mime)) throw E(415, 'Envie uma foto (JPG, PNG, WEBP, GIF ou HEIC) ou um vídeo.');
  const buf = await corpo(req, 50 * 2 ** 20); if (!buf.length) throw E(400, 'Arquivo vazio.');
  const nome = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(MID, nome), buf);
  const treino = sl.t && one('SELECT id FROM treinos WHERE id=?', sl.t) ? sl.t : null;
  run("INSERT INTO envios(aluno_id,data,treino_id,arquivo,tipo,mime,status,ts) VALUES(?,?,?,?,?,?,'PENDENTE',?)", a.id, d, treino, nome, mime.split('/')[0], mime, Date.now());
});
rota('GET', '/api/midia/:id', 'logado', ({ req, res, p, s }) => {
  const e = one('SELECT * FROM envios WHERE id=?', +p.id);
  if (!e || (s.papel === 'aluno' && e.aluno_id !== s.aluno_id)) throw E(404, 'Arquivo não encontrado.');
  enviarArquivo(req, res, path.join(MID, e.arquivo), e.mime);
});

/* portal do aluno */
rota('GET', '/api/aluno/eu', 'aluno', ({ s }) => {
  const a = one('SELECT * FROM alunos WHERE id=?', s.aluno_id), r = JSON.parse(a.rotina), wk = week();
  const tr = new Map(all('SELECT * FROM treinos').map(t => [t.id, t]));
  const { login, temSenha, ...aluno } = fAluno(a);
  return {
    aluno, plano: fPlano(one('SELECT * FROM planos WHERE id=?', a.plano_id)) || null,
    treinos: r.filter(id => tr.has(id)).map(id => fTreino(tr.get(id))),
    envios: all('SELECT * FROM envios WHERE aluno_id=? ORDER BY id', a.id).map(fEnvio),
    hoje: today(), semana: wk,
  };
});

/* backup e restauração */
rota('GET', '/api/backup', 'admin', () => ({
  app: 'biofit', versao: 2, exportadoEm: new Date().toISOString(),
  planos: all('SELECT * FROM planos ORDER BY id').map(fPlano),
  treinos: all('SELECT * FROM treinos ORDER BY id').map(fTreino),
  alunos: all('SELECT * FROM alunos ORDER BY id').map(r => { const { temSenha, ...a } = fAluno(r); return { ...a, hash: r.hash }; }),
  pagamentos: all('SELECT * FROM pagamentos ORDER BY id').map(fPag),
  envios: all('SELECT * FROM envios ORDER BY id').map(r => ({ ...fEnvio(r), arquivo: r.arquivo, mime: r.mime })),
}));
rota('POST', '/api/backup', 'admin', async ({ req }) => {
  const d = (await json(req)).dados;
  if (!d || !Array.isArray(d.alunos) || !Array.isArray(d.planos) || !Array.isArray(d.pagamentos)) throw E(400, 'Texto de backup inválido.');
  const antigo = d.versao !== 2, HASH = /^(scrypt:[0-9a-f]{32}:[0-9a-f]{64}|sha256:[0-9a-f]{64})$/;
  try {
    tx(() => {
      run("DELETE FROM sessoes WHERE papel='aluno'");
      for (const t of ['envios', 'pagamentos', 'alunos', 'treinos', 'planos']) run('DELETE FROM ' + t);
      for (const p of d.planos) run('INSERT INTO planos(id,nome,valor,meses,freq) VALUES(?,?,?,?,?)', intIn(p.id, 1, 2 ** 40, 'Plano sem id.'), txt(p.nome, 120) || 'Plano', Math.max(0, num(p.valor) || 0), intIn(p.meses ?? 1, 1, 36, 'Plano com duração inválida.'), intIn(p.freq ?? 3, 1, 7, 'Plano com frequência inválida.'));
      for (const t of d.treinos || []) run('INSERT INTO treinos(id,nome,ex) VALUES(?,?,?)', intIn(t.id, 1, 2 ** 40, 'Treino sem id.'), txt(t.nome, 120) || 'Treino', JSON.stringify(normEx(t.ex)));
      const planos = new Set(all('SELECT id FROM planos').map(r => r.id)), treinos = new Set(all('SELECT id FROM treinos').map(r => r.id));
      for (const a of d.alunos) {
        let cpf; try { cpf = fmtCpf(a.cpf); } catch { cpf = txt(a.cpf, 20) || 'sem-cpf-' + a.id; }
        const h = antigo ? (a.h ? 'sha256:' + a.h : null) : a.hash;
        run('INSERT INTO alunos(id,nome,cpf,telefone,email,plano_id,inicio,venc,status,login,hash,rotina) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          intIn(a.id, 1, 2 ** 40, 'Aluno sem id.'), txt(a.nome, 120) || 'Sem nome', cpf, txt(a.telefone, 40), txt(a.email, 120),
          planos.has(a.planoId) ? a.planoId : null, isDate(a.inicio) ? a.inicio : today(), isDate(a.venc) ? a.venc : null,
          a.status === 'INATIVO' ? 'INATIVO' : 'ATIVO', txt(a.login, 60).toLowerCase() || null, typeof h === 'string' && HASH.test(h) ? h : null,
          JSON.stringify((Array.isArray(a.rotina) ? a.rotina : []).map(Number).filter(x => treinos.has(x))));
      }
      const alunos = new Set(all('SELECT id FROM alunos').map(r => r.id));
      for (const p of d.pagamentos) if (alunos.has(p.alunoId) && isDate(p.data)) run("INSERT INTO pagamentos(aluno_id,plano_id,valor,data,status) VALUES(?,?,?,?,'PAGO')", p.alunoId, planos.has(p.planoId) ? p.planoId : null, Math.max(0, num(p.valor) || 0), p.data);
      if (!antigo) for (const e of d.envios || []) {
        if (!alunos.has(e.alunoId) || !isDate(e.data) || !/^[a-f0-9]{32}$/.test(e.arquivo || '') || !MIME_OK.test(e.mime || '') || !fs.existsSync(path.join(MID, e.arquivo))) continue;
        run('INSERT INTO envios(aluno_id,data,treino_id,arquivo,tipo,mime,status,ts) VALUES(?,?,?,?,?,?,?,?)', e.alunoId, e.data, treinos.has(e.treinoId) ? e.treinoId : null, e.arquivo, e.mime.split('/')[0], e.mime,
          ['PENDENTE', 'APROVADO', 'REJEITADO'].includes(e.status) ? e.status : 'PENDENTE', Number(e.ts) || Date.now());
      }
    });
  } catch (e) {
    if (e.st) throw e;
    throw E(400, /UNIQUE/.test(e.message) ? 'O backup tem CPFs ou usuários repetidos.' : 'Não foi possível restaurar este backup.');
  }
  const usados = new Set(all('SELECT arquivo FROM envios').map(r => r.arquivo));
  for (const f of fs.readdirSync(MID)) if (!usados.has(f)) fs.rm(path.join(MID, f), { force: true }, () => {});
});

/* ---------- servidor ---------- */
const srv = http.createServer(async (req, res) => {
  let url; try { url = new URL(req.url, 'http://local'); } catch { res.writeHead(400); return res.end(); }
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw E(405, 'Método não permitido.');
      const est = ESTATICOS[url.pathname]; if (!est) throw E(404, 'Página não encontrada.');
      let corpoArq; try { corpoArq = fs.readFileSync(path.join(PUB, est[0])); } catch { throw E(404, 'Página não encontrada.'); }
      const h = { 'Content-Type': est[1], 'Cache-Control': est[2], 'Content-Length': corpoArq.length, ...SEG };
      if (httpsDe(req)) h['Strict-Transport-Security'] = 'max-age=15552000';
      res.writeHead(200, h);
      return res.end(req.method === 'HEAD' ? undefined : corpoArq);
    }
    const r = rotas.find(x => x.m === req.method && x.re.test(url.pathname)); if (!r) throw E(404, 'Rota não encontrada.');
    const p = r.re.exec(url.pathname).groups || {}, s = sessao(req);
    if ((r.papel === 'admin' || r.papel === 'aluno') && s?.papel !== r.papel) throw E(401, 'Sua sessão expirou. Entre de novo.');
    if (r.papel === 'logado' && !s) throw E(401, 'Sua sessão expirou. Entre de novo.');
    const out = await r.fn({ req, res, url, p, s });
    if (!res.headersSent) enviar(res, 200, out ?? { ok: true });
  } catch (e) {
    req.resume();
    if (!e.st) console.error(e);
    if (!res.headersSent) enviar(res, e.st || 500, { erro: e.st ? e.message : 'Erro interno no servidor.' }); else res.destroy();
  }
});
srv.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\nA porta ${PORT} já está em uso. Feche o outro programa ou rode com outra porta, por exemplo: PORT=3001 node server.js\n`);
  else console.error(e);
  process.exit(1);
});
srv.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n  Biofit rodando!\n');
  console.log(`  Neste computador:   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Na mesma rede Wi-Fi: http://${ip}:${PORT}`);
  console.log(`\n  Banco de dados: ${path.join(DATA, 'biofit.db')}`);
  console.log('  Para parar, feche esta janela ou aperte Ctrl+C.\n');
});
const sair = () => { try { sql.close(); } catch {} process.exit(0); };
process.on('SIGINT', sair); process.on('SIGTERM', sair);
