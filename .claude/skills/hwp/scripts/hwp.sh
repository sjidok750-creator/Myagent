#!/usr/bin/env bash
#
# 한글 문서(.hwpx) 만들기 · 읽기
#
#   hwp.sh create <입력.md> <출력.hwpx>
#   hwp.sh read   <파일.hwpx>
#
# 처음 한 번은 라이브러리를 내려받고 컴파일한다(10초 안팎). 그다음부터는 바로 돈다.
#
# 로케일을 여기서 강제로 잡는 이유가 있다. JVM 은 sun.jnu.encoding 을 아주 이른
# 시점에 읽어서, -D 플래그로는 이미 늦다. 로케일이 UTF-8 이 아니면 "사업계획서.hwpx"
# 같은 한글 파일명이 물음표로 뭉개지고 파일을 찾지 못한다.
export LANG=${LANG:-C.UTF-8}
export LC_ALL=C.UTF-8

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${HWP_SKILL_CACHE:-$HOME/.cache/hwp-skill}"
JAR="$CACHE/hwpxlib.jar"
CLASSES="$CACHE/classes"
VERSION="1.0.9"
JAR_URL="https://repo1.maven.org/maven2/kr/dogfoot/hwpxlib/${VERSION}/hwpxlib-${VERSION}.jar"

die() { echo "오류: $*" >&2; exit 1; }

command -v java >/dev/null 2>&1 || die "자바가 필요합니다. (macOS: brew install openjdk / Ubuntu: sudo apt install default-jre-headless)"

# --- 라이브러리 준비 (처음 한 번만) -----------------------------------------
if [ ! -f "$JAR" ]; then
  mkdir -p "$CACHE"
  echo "한글 문서 라이브러리를 내려받는 중… (처음 한 번만)" >&2
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$JAR.tmp" "$JAR_URL" || die "라이브러리를 내려받지 못했습니다. 네트워크를 확인해 주세요."
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$JAR.tmp" "$JAR_URL" || die "라이브러리를 내려받지 못했습니다."
  else
    die "curl 이나 wget 이 필요합니다."
  fi
  mv "$JAR.tmp" "$JAR"
fi

# --- 컴파일 (소스가 바뀌었을 때만) -------------------------------------------
SRC="$HERE/java/HwpTool.java"
[ -f "$SRC" ] || die "HwpTool.java 를 찾을 수 없습니다: $SRC"

if [ ! -f "$CLASSES/HwpTool.class" ] || [ "$SRC" -nt "$CLASSES/HwpTool.class" ]; then
  command -v javac >/dev/null 2>&1 || die "javac 가 필요합니다. JRE 말고 JDK 를 설치해 주세요."
  mkdir -p "$CLASSES"
  echo "도구를 준비하는 중…" >&2
  javac -encoding UTF-8 -cp "$JAR" -d "$CLASSES" "$SRC" 2>&1 | grep -v '^Picked up' >&2 || true
  [ -f "$CLASSES/HwpTool.class" ] || die "컴파일에 실패했습니다."
fi

# --- 실행 -------------------------------------------------------------------
# JAVA_TOOL_OPTIONS 가 설정돼 있으면 JVM 이 "Picked up ..." 을 표준출력에 찍어
# 결과와 섞인다. 빈 값으로 두면 그래도 찍히므로 아예 지우고 실행한다.
exec env -u JAVA_TOOL_OPTIONS java \
  -Dfile.encoding=UTF-8 \
  -Dsun.stdout.encoding=UTF-8 \
  -Dsun.stderr.encoding=UTF-8 \
  -cp "$JAR:$CLASSES" HwpTool "$@"
