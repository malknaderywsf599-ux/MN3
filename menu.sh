#!/bin/sh
# FreeLLM Menu — قائمة تفاعلية لتشغيل Claude Code على موديلات مجانية
# تشتغل بـ sh عادي (ArabTerm / Termux / Linux):   sh menu.sh
# Interactive POSIX-sh menu to run Claude Code on free LLMs through the FreeLLM proxy.

DIR=$(cd "$(dirname "$0")" && pwd)
DATA="${FREELLM_HOME:-$HOME/.freellm}"
KEYS="$DATA/keys.env"
PIDF="$DATA/proxy.pid"
LOGF="$DATA/proxy.log"
PORT="${PORT:-8787}"
UI="${UI:-ar}"
mkdir -p "$DATA" 2>/dev/null
[ -f "$KEYS" ] || { : > "$KEYS"; chmod 600 "$KEYS" 2>/dev/null; }

# ---- colors (disable with NO_COLOR=1)
if [ -z "$NO_COLOR" ]; then
  R=$(printf '\033[0m'); B=$(printf '\033[1m'); G=$(printf '\033[32m'); Y=$(printf '\033[33m')
  C=$(printf '\033[36m'); E=$(printf '\033[31m'); D=$(printf '\033[2m')
else R=; B=; G=; Y=; C=; E=; D=; fi

# t "عربي" "english"
t() { if [ "$UI" = ar ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }

say()  { printf '%b\n' "$*"; }
ok()   { printf '%s✔ %s%s\n' "$G" "$*" "$R"; }
warn() { printf '%s! %s%s\n' "$Y" "$*" "$R"; }
err()  { printf '%s✘ %s%s\n' "$E" "$*" "$R"; }
pause() { printf '\n%s%s%s' "$D" "$(t 'اضغط Enter للرجوع...' 'Press Enter to go back...')" "$R"; read -r _; }
have() { command -v "$1" >/dev/null 2>&1; }

# provider table: name|ENV
PROVIDERS="Gemini|GEMINI_API_KEY GLM|ZAI_API_KEY Qwen|QWEN_API_KEY Mistral|MISTRAL_API_KEY NVIDIA|NVIDIA_API_KEY"

getkey() { # $1 = env name -> value from keys file
  [ -f "$KEYS" ] || return
  sed -n "s/^export $1='\\(.*\\)'\$/\\1/p" "$KEYS" | tail -n 1
}
setkey() { # $1 env, $2 value
  grep -v "^export $1=" "$KEYS" > "$KEYS.tmp" 2>/dev/null
  [ -n "$2" ] && printf "export %s='%s'\n" "$1" "$2" >> "$KEYS.tmp"
  mv "$KEYS.tmp" "$KEYS"; chmod 600 "$KEYS" 2>/dev/null
}
mask() { v="$1"; [ -z "$v" ] && { t 'غير مضبوط' 'not set'; return; }; n=${#v}; [ "$n" -le 6 ] && printf '******' || printf '****%s' "$(printf '%s' "$v" | tail -c 4)"; }

proxy_running() {
  [ -f "$PIDF" ] || return 1
  pid=$(cat "$PIDF" 2>/dev/null); [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}
http_get() {
  if have curl; then curl -s --max-time 5 "$1"
  elif have wget; then wget -qO- -T 5 "$1"
  elif have node; then node -e "fetch(process.argv[1]).then(r=>r.text()).then(console.log)" "$1"
  else return 1; fi
}
configured_count() { n=0; for p in $PROVIDERS; do [ -n "$(getkey "${p#*|}")" ] && n=$((n+1)); done; echo "$n"; }

header() {
  clear 2>/dev/null || printf '\033c'
  say "${C}╔══════════════════════════════════════════╗${R}"
  say "${C}║${R}  ${B}FreeLLM Menu${R}  ·  $(t 'Claude Code بموديلات مجانية' 'Claude Code on free models')"
  say "${C}╚══════════════════════════════════════════╝${R}"
  if proxy_running; then st="${G}● $(t 'شغّال' 'running')${R} :$PORT"; else st="${E}○ $(t 'واقف' 'stopped')${R}"; fi
  say " $(t 'البروكسي' 'Proxy'): $st    $(t 'المفاتيح' 'Keys'): ${B}$(configured_count)${R}/5    $(t 'اللغة' 'UI'): $UI"
  say "${D}──────────────────────────────────────────${R}"
}

# ---------------------------------------------------------------- actions
do_check() {
  header; say "${B}$(t 'فحص المتطلبات' 'Requirements check')${R}\n"
  for tool in node npm curl claude; do
    if have "$tool"; then ok "$tool  ${D}$("$tool" --version 2>/dev/null | head -n 1)${R}"; else err "$tool  $(t 'غير موجود' 'missing')"; fi
  done
  if have node; then
    maj=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)
    [ "${maj:-0}" -ge 18 ] 2>/dev/null && ok "Node >= 18" || warn "$(t 'محتاج Node 18 أو أحدث' 'Need Node 18+')"
  fi
  [ -f "$DIR/server.js" ] && ok "server.js" || err "server.js $(t 'مش موجود جنب menu.sh' 'not next to menu.sh')"
  [ -f "$DIR/providers.json" ] && ok "providers.json" || err "providers.json $(t 'مش موجود' 'missing')"
  pause
}

do_install() {
  header; say "${B}$(t 'تثبيت' 'Install')${R}\n"
  say " 1) $(t 'تثبيت Node.js (عن طريق pkg / apt)' 'Install Node.js (via pkg / apt)')"
  say " 2) $(t 'تثبيت Claude Code (npm)' 'Install Claude Code (npm)')"
  say " 0) $(t 'رجوع' 'Back')"
  printf '\n> '; read -r c
  case "$c" in
    1) if have pkg; then pkg install -y nodejs
       elif have apt-get; then apt-get install -y nodejs npm || sudo apt-get install -y nodejs npm
       else err "$(t 'مفيش pkg ولا apt. نزّل Node من nodejs.org أو استخدم Termux.' 'No pkg/apt. Install Node from nodejs.org or use Termux.')"; fi; pause ;;
    2) if have npm; then npm install -g @anthropic-ai/claude-code; else err "$(t 'ثبّت Node أولًا (الخيار 1)' 'Install Node first (option 1)')"; fi; pause ;;
  esac
}

do_keys() {
  while :; do
    header; say "${B}$(t 'مفاتيح API المجانية' 'Free API keys')${R}"
    say "${D}$(t 'كفاية مفتاح واحد. ممكن أكتر من مفتاح لنفس المزوّد مفصولين بفاصلة.' 'One is enough. Several keys per provider: comma-separated.')${R}\n"
    i=1; for p in $PROVIDERS; do
      name=${p%%|*}; env=${p#*|}
      say " $i) $name  ${D}($env)${R}  → $(mask "$(getkey "$env")")"; i=$((i+1))
    done
    say " 0) $(t 'رجوع' 'Back')"
    printf '\n> '; read -r c
    [ "$c" = 0 ] && return
    i=1; for p in $PROVIDERS; do
      if [ "$c" = "$i" ]; then
        env=${p#*|}; printf '%s %s (%s) : ' "$(t 'الصق المفتاح لـ' 'Paste key for')" "${p%%|*}" "$(t 'فاضي = مسح' 'empty = remove')"
        read -r v; setkey "$env" "$v"; ok "$(t 'اتحفظ' 'Saved')"; sleep 1
      fi; i=$((i+1))
    done
  done
}

do_start() {
  header
  have node || { err "$(t 'Node مش مثبّت (من التثبيت اختار 1)' 'Node missing (Install → 1)')"; pause; return; }
  [ -f "$DIR/server.js" ] || { err "server.js $(t 'مش موجود' 'missing')"; pause; return; }
  [ "$(configured_count)" -gt 0 ] || { err "$(t 'ضيف مفتاح واحد على الأقل (الخيار 3)' 'Add at least one key (option 3)')"; pause; return; }
  proxy_running && { warn "$(t 'البروكسي شغال بالفعل' 'Proxy already running')"; pause; return; }
  ( . "$KEYS"; export PORT; cd "$DIR" && nohup node server.js >"$LOGF" 2>&1 & echo $! > "$PIDF" )
  sleep 1
  if proxy_running; then ok "$(t 'البروكسي اشتغل على' 'Proxy started on') http://127.0.0.1:$PORT"; else err "$(t 'فشل التشغيل. شوف السجل:' 'Failed. See log:')"; tail -n 8 "$LOGF"; fi
  pause
}

do_stop() {
  header
  if proxy_running; then kill "$(cat "$PIDF")" 2>/dev/null; rm -f "$PIDF"; ok "$(t 'اتوقّف' 'Stopped')"; else warn "$(t 'مش شغال' 'Not running')"; fi
  pause
}

do_status() {
  header; say "${B}$(t 'الحالة' 'Status')${R}\n"
  if proxy_running; then
    out=$(http_get "http://127.0.0.1:$PORT/status")
    if [ -n "$out" ] && have node; then
      printf '%s' "$out" | node -e '
        let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
        console.log("current:", j.current||"-");
        for(const p of j.providers) console.log((p.available?"● ":"○ ")+p.name.padEnd(9)+p.model.padEnd(34)+"req "+p.requests+"  fail "+p.failures+"  tokens "+p.tokensToday+(p.cooldownSec?"  cooldown "+p.cooldownSec+"s":""));
        if(j.lastHandoff) console.log("last handoff:", j.lastHandoff.from,"->",j.lastHandoff.to);})'
    else say "$out"; fi
  else warn "$(t 'البروكسي واقف' 'Proxy is stopped')"; fi
  pause
}

do_claude() {
  header
  have claude || { err "$(t 'Claude Code مش مثبّت (التثبيت → 2)' 'Claude Code missing (Install → 2)')"; pause; return; }
  proxy_running || { warn "$(t 'البروكسي واقف، هشغّله الأول' 'Proxy stopped, starting it first')"; do_start; proxy_running || return; }
  say "$(t 'بشغّل Claude Code على البروكسي... (اخرج منه بـ /exit)' 'Launching Claude Code via proxy... (leave with /exit)')"
  ANTHROPIC_BASE_URL="http://127.0.0.1:$PORT" ANTHROPIC_AUTH_TOKEN=x claude
}

do_log() { header; say "${B}$(t 'آخر سطور السجل' 'Last log lines')${R}\n"; [ -f "$LOGF" ] && tail -n 25 "$LOGF" || warn "$(t 'مفيش سجل' 'No log')"; pause; }

do_settings() {
  header; say "${B}$(t 'الإعدادات' 'Settings')${R}\n"
  say " 1) $(t 'تغيير اللغة (عربي / English)' 'Switch language (Arabic / English)')"
  say " 2) $(t 'تغيير المنفذ' 'Change port') (${PORT})"
  say " 3) $(t 'تعديل ترتيب الموديلات (providers.json)' 'Edit model order (providers.json)')"
  say " 0) $(t 'رجوع' 'Back')"
  printf '\n> '; read -r c
  case "$c" in
    1) [ "$UI" = ar ] && UI=en || UI=ar ;;
    2) printf 'Port: '; read -r p; case "$p" in ''|*[!0-9]*) err 'invalid'; sleep 1;; *) PORT="$p"; warn "$(t 'اعمل Stop ثم Start عشان يتطبق' 'Stop then Start to apply')"; pause;; esac ;;
    3) ed="${EDITOR:-}"; [ -z "$ed" ] && { have nano && ed=nano || { have vi && ed=vi; }; }
       if [ -n "$ed" ]; then "$ed" "$DIR/providers.json"; else say "$(t 'مفيش محرر. عدّل الملف يدويًا:' 'No editor. Edit manually:') $DIR/providers.json"; pause; fi ;;
  esac
}

do_test() {
  header; say "${B}$(t 'اختبار ذاتي' 'Self test')${R}\n"
  if [ -f "$DIR/test/test.js" ] && have node; then node "$DIR/test/test.js"; else warn "$(t 'ملف الاختبار مش موجود (اختياري)' 'test file not present (optional)')"; fi
  pause
}

# ---------------------------------------------------------------- main loop
while :; do
  header
  say " 1) $(t 'تشغيل البروكسي' 'Start proxy')"
  say " 2) $(t 'إيقاف البروكسي' 'Stop proxy')"
  say " 3) $(t 'مفاتيح API' 'API keys')"
  say " 4) $(t 'تشغيل Claude Code' 'Launch Claude Code')"
  say " 5) $(t 'الحالة والاستهلاك' 'Status & usage')"
  say " 6) $(t 'تثبيت Node / Claude Code' 'Install Node / Claude Code')"
  say " 7) $(t 'فحص المتطلبات' 'Requirements check')"
  say " 8) $(t 'السجل' 'Log')"
  say " 9) $(t 'الإعدادات' 'Settings')"
  say " 0) $(t 'خروج' 'Exit')"
  printf '\n> '; read -r choice || break
  case "$choice" in
    1) do_start ;; 2) do_stop ;; 3) do_keys ;; 4) do_claude ;; 5) do_status ;;
    6) do_install ;; 7) do_check ;; 8) do_log ;; 9) do_settings ;; 10|t) do_test ;;
    0|q|exit) say "$(t 'مع السلامة 👋' 'Bye 👋')"; exit 0 ;;
  esac
done
