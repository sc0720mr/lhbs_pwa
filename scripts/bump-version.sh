#!/usr/bin/env bash
# ==========================================================================
# bump-version.sh — 水蓮社區巴士 PWA｜版本號一鍵同步
# --------------------------------------------------------------------------
# 為什麼需要這支腳本：
#   這個專案是純靜態（GitHub Pages），沒有 build 步驟，所以版本號會散落在
#   四個地方。只要漏改一個，瀏覽器就會因為「網址沒變」而命中舊快取，
#   出現「檔案已經改了、畫面卻還是舊的」。
#
#   這支腳本把 version.json 當成唯一來源，一次改完四個位置。
#
# 用法：
#   ./scripts/bump-version.sh 6.4.1        # 指定新版本，cache 自動 +1
#   ./scripts/bump-version.sh 6.4.1 v41    # 同時指定 cache 版號
#   ./scripts/bump-version.sh --check      # 只檢查四處是否一致，不改檔
#
# 會更新的四個位置：
#   1) index.html   <meta name="app-version"> 與 <meta name="app-cache-version">
#   2) index.html   所有 ?v= 查詢字串（manifest / style.css / js / 安裝步驟圖）
#   3) js/core.js   var BUILD = 'LHBS build X.Y.Z / cache vNN'
#   4) service-worker.js  const CACHE_VERSION = 'vNN'
#   5) version.json 本身
# ==========================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION_FILE="version.json"
INDEX="index.html"
CORE="js/core.js"
SW="service-worker.js"

die() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
ok()  { printf '\033[32m✓ %s\033[0m\n' "$1"; }

[ -f "$INDEX" ] || die "找不到 index.html，請在專案根目錄執行"
[ -f "$CORE" ]  || die "找不到 js/core.js"
[ -f "$SW" ]    || die "找不到 service-worker.js"

# 讀出目前四處的版本，用來檢查一致性
read_meta_ver()  { grep -o 'name="app-version" content="[^"]*"' "$INDEX" | head -1 | sed 's/.*content="//;s/"//'; }
read_meta_cache(){ grep -o 'name="app-cache-version" content="[^"]*"' "$INDEX" | head -1 | sed 's/.*content="//;s/"//'; }
read_build()     { grep -o "var BUILD = 'LHBS build [^']*'" "$CORE" | head -1 | sed "s/.*build //;s/ \/ cache.*//"; }
read_build_cache(){ grep -o "var BUILD = 'LHBS build [^']*'" "$CORE" | head -1 | sed "s/.*cache //;s/'//"; }
read_sw_cache()  { grep -o "const CACHE_VERSION = '[^']*'" "$SW" | head -1 | sed "s/.*'\(.*\)'/\1/"; }
read_manifest_q(){ grep -o 'manifest.json?v=[^"]*' "$INDEX" | head -1 | sed 's/.*?v=//'; }

check() {
  local m mc b bc s mq
  m=$(read_meta_ver); mc=$(read_meta_cache); b=$(read_build); bc=$(read_build_cache); s=$(read_sw_cache); mq=$(read_manifest_q)
  printf '  index.html  app-version        : %s\n' "$m"
  printf '  index.html  app-cache-version  : %s\n' "$mc"
  printf '  index.html  manifest.json?v=   : %s\n' "$mq"
  printf '  js/core.js  BUILD version      : %s\n' "$b"
  printf '  js/core.js  BUILD cache        : %s\n' "$bc"
  printf '  service-worker.js CACHE_VERSION: %s\n' "$s"
  if [ "$m" = "$b" ] && [ "$m" = "$mq" ] && [ "$mc" = "$bc" ] && [ "$mc" = "$s" ]; then
    ok "四處版本號完全一致（$m / $mc）"
    return 0
  else
    printf '\033[31m✗ 版本號不一致，請執行 ./scripts/bump-version.sh <版本>\033[0m\n'
    return 1
  fi
}

if [ "${1:-}" = "--check" ]; then
  echo "── 版本號一致性檢查 ──"
  check
  exit $?
fi

NEW_VER="${1:-}"
[ -n "$NEW_VER" ] || die "請指定版本號，例如：./scripts/bump-version.sh 6.4.1"
echo "$NEW_VER" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "版本號格式應為 X.Y.Z（例如 6.4.1）"

# cache 版號：沒指定就從現有 +1
CUR_CACHE=$(read_sw_cache)
if [ -n "${2:-}" ]; then
  NEW_CACHE="$2"
else
  NUM=$(echo "$CUR_CACHE" | sed 's/^v//')
  case "$NUM" in
    ''|*[!0-9]*) die "目前 cache 版號 '$CUR_CACHE' 不是 v<數字> 格式，請手動指定第二個參數" ;;
  esac
  NEW_CACHE="v$((NUM + 1))"
fi

echo "── 更新版本：$NEW_VER / cache $NEW_CACHE ──"

# 1) version.json
cat > "$VERSION_FILE" <<EOF
{
  "version": "$NEW_VER",
  "cache": "$NEW_CACHE",
  "note": "這是全站唯一的版本來源。改版時只改這個檔，然後執行 scripts/bump-version.sh 同步所有位置。"
}
EOF
ok "version.json"

# 2) index.html 的兩個 meta
sed -i.bak -E "s|(<meta name=\"app-version\" content=\")[^\"]*(\")|\1${NEW_VER}\2|" "$INDEX"
sed -i.bak -E "s|(<meta name=\"app-cache-version\" content=\")[^\"]*(\")|\1${NEW_CACHE}\2|" "$INDEX"
# 3) index.html 所有 ?v= 查詢字串
sed -i.bak -E "s|\?v=[0-9]+\.[0-9]+\.[0-9]+|\?v=${NEW_VER}|g" "$INDEX"
ok "index.html（meta ×2 + 所有 ?v=）"

# 4) js/core.js 的 BUILD
sed -i.bak -E "s|var BUILD = 'LHBS build [^']*'|var BUILD = 'LHBS build ${NEW_VER} / cache ${NEW_CACHE}'|" "$CORE"
ok "js/core.js BUILD"

# 5) service-worker.js 的 CACHE_VERSION
sed -i.bak -E "s|const CACHE_VERSION = '[^']*'|const CACHE_VERSION = '${NEW_CACHE}'|" "$SW"
ok "service-worker.js CACHE_VERSION"

rm -f "$INDEX.bak" "$CORE.bak" "$SW.bak"

echo
echo "── 驗證 ──"
check
echo
echo "下一步：git add -A && git commit -m \"版本 $NEW_VER\" && git push"
