#!/usr/bin/env node
// cli-ops.mjs — 运维命令行工具 (v1)
// Usage: node cli-ops.mjs <command> [args]
//
// Commands:
//   status         服务器总览（会话数/模型健康/运行时间）
//   sessions       列出所有活跃会话
//   models         模型统计（成功率/失败次数/最后状态）
//   kill <id>      终止指定会话
//   tail           持续监控（每 5s 刷新）

const BASE = process.env.OPS_BASE_URL || 'http://127.0.0.1:3000';
const INTERVAL = parseInt(process.env.OPS_INTERVAL || '5000');

function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function since(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}
function pct(n) { return n == null ? '—' : n + '%'; }
function healthIcon(h) {
  const map = { ok: '🟢', retrying: '🟡', connecting: '⚪', error: '🔴' };
  return (map[h] || '⚫') + ' ' + h;
}

async function fetchJson(path) {
  try {
    const r = await fetch(`${BASE}${path}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.error(`无法连接 ${BASE}${path}: ${e.message}`);
    process.exit(1);
  }
}

function printStatus(j) {
  const dur = Math.floor(j.uptime);
  const h = Math.floor(dur / 3600), m = Math.floor((dur % 3600) / 60), s = dur % 60;
  console.log('═══════════════════════════════════');
  console.log('  服务器概览');
  console.log('═══════════════════════════════════');
  console.log(`  运行时间  ${h}h ${m}m ${s}s`);
  console.log(`  活跃会话  ${j.sessions?.length || 0}`);
  console.log(`  追踪模型  ${j.models?.length || 0}`);
  console.log();

  if (j.models?.length) {
    console.log('  ── 模型统计 ──');
    console.log('  模型                                  总/成功/失败  成功率  最后正常');
    j.models.forEach(m => {
      console.log(`  ${m.id.padEnd(38)} ${m.total}/${m.success}/${m.fail}  ${pct(m.successRate).padStart(5)}  ${since(m.lastOk)}`);
    });
  }

  if (j.sessions?.length) {
    console.log();
    console.log('  ── 会话状态 ──');
    j.sessions.forEach(s => {
      console.log(`  ${healthIcon(s.health).padEnd(18)} ${s.model?.substring(0, 35).padEnd(37)} ${since(s.createdAt)}`);
    });
  }
  console.log('═══════════════════════════════════');
}

function printSessions(data) {
  if (!data.sessions?.length) { console.log('无活跃会话'); return; }
  console.log('会话ID                                 模型                            健康      创建时间');
  console.log('─'.repeat(130));
  data.sessions.forEach(s => {
    const sid = (s.sessionId || '').substring(0, 34).padEnd(36);
    const model = (s.model || '').substring(0, 33).padEnd(34);
    console.log(`${sid} ${model} ${healthIcon(s.health).padEnd(18)} ${since(s.createdAt)}`);
  });
}

function printModels(data) {
  if (!data.models?.length) { console.log('无统计数据'); return; }
  const total = data.models.reduce((a, m) => a + m.total, 0);
  const ok = data.models.reduce((a, m) => a + m.success, 0);
  console.log(`全局成功率: ${pct(total > 0 ? ((ok / total) * 100).toFixed(1) : '0.0')}  (${ok}/${total})`);
  console.log();
  console.log('模型                                      总请求 成功 失败  成功率   最后OK    最后错误');
  console.log('─'.repeat(115));
  data.models.forEach(m => {
    const id = m.id.substring(0, 40).padEnd(41);
    console.log(`${id} ${String(m.total).padStart(5)} ${String(m.success).padStart(4)} ${String(m.fail).padStart(4)}  ${pct(m.successRate).padStart(5)}  ${since(m.lastOk).padEnd(9)} ${(m.lastError || '—').padEnd(12)}`);
  });
}

async function cmdStatus() {
  const j = await fetchJson('/api/health/detailed');
  printStatus(j);
}

async function cmdSessions() {
  const j = await fetchJson('/api/health/detailed');
  printSessions(j);
}

async function cmdModels() {
  const j = await fetchJson('/api/health/detailed');
  printModels(j);
}

async function cmdKill(sid) {
  if (!sid) { console.log('用法: node cli-ops.mjs kill <sessionId>'); process.exit(1); }
  try {
    const r = await fetch(`${BASE}/api/session/${sid}`, { method: 'DELETE' });
    const j = await r.json();
    if (j.success) console.log(`会话 ${sid} 已终止`);
    else console.log(`终止失败: ${JSON.stringify(j)}`);
  } catch (e) {
    console.error(`终止失败: ${e.message}`);
  }
}

function cmdTail() {
  console.log(`持续监控 (${INTERVAL / 1000}s 间隔, Ctrl+C 退出)`);
  const tick = async () => {
    try {
      const j = await fetchJson('/api/health/detailed');
      console.clear();
      printStatus(j);
    } catch (e) {
      console.error(`轮询失败: ${e.message}`);
    }
  };
  tick();
  setInterval(tick, INTERVAL);
}

// ── main ──
const cmd = process.argv[2];
const arg = process.argv[3];

switch (cmd) {
  case 'status':   cmdStatus();  break;
  case 'sessions': cmdSessions(); break;
  case 'models':   cmdModels();  break;
  case 'kill':     cmdKill(arg); break;
  case 'tail':     cmdTail();    break;
  default:
    console.log('cli-ops.mjs — 运维命令行工具');
    console.log();
    console.log('命令:');
    console.log('  status       服务器总览');
    console.log('  sessions     列出活跃会话');
    console.log('  models       模型成功率统计');
    console.log('  kill <id>    终止指定会话');
    console.log('  tail         持续监控');
    console.log();
    console.log('环境变量:');
    console.log('  OPS_BASE_URL  服务地址 (默认 http://127.0.0.1:3000)');
    console.log('  OPS_INTERVAL  tail 刷新间隔毫秒 (默认 5000)');
}
