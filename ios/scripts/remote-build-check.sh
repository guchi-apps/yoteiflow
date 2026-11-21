#!/usr/bin/env bash
# subpc の作業ツリーの ios/ を Tailscale 越しに Mac へ送り、署名なしでビルドできるか確かめる（#1231）。
# subpc に Xcode が無いため、Swift の変更をコミットする前に「コンパイルが通るか」を見る用途。
# 署名・アーカイブ・TestFlightへのアップロードはしない（それは remote-upload-testflight.sh / CI）。
#
#   ios/scripts/remote-build-check.sh
#
# 環境変数（すべて任意）:
#   MAC_HOST      SSH先（既定 guchimac-mini）。`local` を指定するとSSHせずこのマシンでビルドする
#                 （`uname -s` が Darwin＝Mac自身で実行しているときも自動でローカル扱い）
#   MAC_WORK_DIR  Mac 上の作業ディレクトリ（既定 /tmp/yoteiflow-ios-build-check）。毎回この中身を置き換える
#
# 実機での動作（日本語入力・キーボード・TestFlightからの起動）はここでは確かめられない。
set -euo pipefail

HOST="${MAC_HOST:-guchimac-mini}"
WORK_DIR="${MAC_WORK_DIR:-/tmp/yoteiflow-ios-build-check}"
IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Mac自身で動かしているとき（Mac miniのセッション）は自分へSSHしない
if [ "$HOST" = "local" ] || [ "$(uname -s)" = "Darwin" ]; then
  LOCAL=1
else
  LOCAL=0
fi

# Mac側で実行するスクリプトを標準入力で渡す。
# SSH先のログインシェルは zsh で PIPESTATUS が無いため、必ず bash -l -s で受け、pipefail で終了コードを返す
run_on_mac() {
  if [ "$LOCAL" = 1 ]; then
    bash -s
  else
    ssh "$HOST" 'bash -l -s'
  fi
}

if [ "$LOCAL" = 1 ]; then
  mkdir -p "$WORK_DIR/ios"
  rsync -a --delete --exclude build --exclude DerivedData "$IOS_DIR/" "$WORK_DIR/ios/"
else
  ssh "$HOST" "mkdir -p '$WORK_DIR'"
  rsync -az --delete --exclude build --exclude DerivedData "$IOS_DIR/" "$HOST:$WORK_DIR/ios/"
fi

# 終了コードをパイプで隠さない（pipefail）。生成物は作業ディレクトリ内の DerivedData に閉じる
run_on_mac <<SCRIPT
set -euo pipefail
cd '$WORK_DIR/ios'
xcodebuild \
  -project YoteiFlow.xcodeproj -scheme YoteiFlow -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath '$WORK_DIR/DerivedData' \
  CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -n 8
SCRIPT
