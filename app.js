import { Wllama } from 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.1/esm/index.js';

const BASE = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@2.3.1/esm';
const WASM = {
  'single-thread/wllama.wasm': `${BASE}/single-thread/wllama.wasm`,
  'multi-thread/wllama.wasm': `${BASE}/multi-thread/wllama.wasm`,
};

// ---------- النماذج (كلها مفتوحة المصدر وبصيغة Q4 صغيرة) ----------
const MODELS = {
  qwen_coder: { repo: 'Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF', file: 'qwen2.5-coder-0.5b-instruct-q4_k_m.gguf', label: 'Qwen Coder 0.5B' },
  qwen_chat:  { repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',        file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',        label: 'Qwen 1.5B' },
  qwen_fast:  { repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',        file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',        label: 'Qwen 0.5B' },
  gemma:      { repo: 'unsloth/gemma-3-1b-it-GGUF',             file: 'gemma-3-1b-it-Q4_K_M.gguf',                label: 'Gemma 3 1B' },
  llama:      { repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF',   file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',        label: 'Llama 3.2 1B' },
  r1:         { repo: 'bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF', file: 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf', label: 'DeepSeek R1 1.5B' },
};

// لكل فئة: ترتيب النماذج. لو الأول فشل بيجرب اللي بعده تلقائيًا.
const CHAINS = {
  code:   ['qwen_coder', 'qwen_chat', 'qwen_fast'],
  reason: ['r1', 'qwen_chat', 'gemma'],
  chat:   ['qwen_chat', 'gemma', 'llama', 'qwen_fast'],
  quick:  ['qwen_fast', 'llama'],
};

// ---------- الراوتر: يصنّف السؤال ----------
const RULES = [
  ['code',   /(كود|برمج|دالة|function|class|python|javascript|js\b|html|css|bug|error|خطأ|اكتب.*(سكريبت|برنامج)|```|=>|def |import )/i],
  ['reason', /(حل|احسب|معادلة|اثبت|لماذا|ليه|فكر|خطوة بخطوة|منطق|مسألة|math|solve|prove|reason|calculate|\d+\s*[\+\-\*\/\^]\s*\d+)/i],
];
function classify(text) {
  for (const [name, re] of RULES) if (re.test(text)) return name;
  if (text.trim().length < 25) return 'quick';
  return 'chat';
}

// ---------- إدارة النموذج الحالي ----------
let wllama = null;
let currentKey = null;
const $ = (id) => document.getElementById(id);
const setStatus = (t) => ($('status').textContent = t);

async function loadModel(key) {
  if (currentKey === key && wllama) return;
  if (wllama) { try { await wllama.exit(); } catch {} wllama = null; currentKey = null; }
  const m = MODELS[key];
  wllama = new Wllama(WASM);
  setStatus(`تحميل ${m.label}...`);
  await wllama.loadModelFromHF(m.repo, m.file, {
    n_ctx: 2048,
    progressCallback: ({ loaded, total }) => {
      const p = total ? Math.round((loaded / total) * 100) : 0;
      $('bar').style.width = p + '%';
      setStatus(`تحميل ${m.label}: ${p}%`);
    },
  });
  $('bar').style.width = '0%';
  currentKey = key;
}

async function loadWithFallback(category) {
  const errors = [];
  for (const key of CHAINS[category]) {
    try { await loadModel(key); return key; }
    catch (e) { errors.push(`${key}: ${e.message || e}`); wllama = null; currentKey = null; }
  }
  throw new Error('كل النماذج فشلت:\n' + errors.join('\n'));
}

// ---------- الدردشة ----------
const history = [];
const SYSTEM = 'أنت مساعد ذكي ومفيد. رد بنفس لغة المستخدم بإيجاز ووضوح.';

function addMsg(cls, text, tag) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  if (tag) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = tag; d.appendChild(t); }
  const body = document.createElement('span');
  body.textContent = text;
  d.appendChild(body);
  $('chat').appendChild(d);
  $('chat').scrollTop = $('chat').scrollHeight;
  return body;
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('input').value.trim();
  if (!text) return;
  $('input').value = '';
  $('send').disabled = true;
  addMsg('user', text);

  const category = classify(text);
  try {
    const key = await loadWithFallback(category);
    const out = addMsg('bot', '...', `${MODELS[key].label} • ${category}`);
    history.push({ role: 'user', content: text });
    const messages = [{ role: 'system', content: SYSTEM }, ...history.slice(-6)];
    setStatus('بيكتب...');
    const reply = await wllama.createChatCompletion(messages, {
      nPredict: 400,
      sampling: { temp: 0.6, top_p: 0.9 },
      onNewToken: (_t, _p, currentText) => {
        out.textContent = currentText;
        $('chat').scrollTop = $('chat').scrollHeight;
      },
    });
    out.textContent = reply;
    history.push({ role: 'assistant', content: reply });
    setStatus('جاهز');
  } catch (err) {
    addMsg('bot', 'حصل خطأ: ' + (err.message || err));
    setStatus('خطأ');
  } finally {
    $('send').disabled = false;
  }
});
