#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
sdkmanager 'platforms;android-35' 'build-tools;35.0.0' >/dev/null
BT="$ANDROID_HOME/build-tools/35.0.0"
JAR="$ANDROID_HOME/platforms/android-35/android.jar"
mkdir -p assets/www/css assets/www/dist out/classes out/dex
cp ../index.html assets/www/
cp ../css/*.css assets/www/css/
cp ../dist/bundle.js assets/www/dist/
javac -source 8 -target 8 -classpath "$JAR" -d out/classes src/com/steelfrontier/game/MainActivity.java
"$BT/d8" --lib "$JAR" --output out/dex out/classes/com/steelfrontier/game/MainActivity.class
"$BT/aapt" package -f -M AndroidManifest.xml -S res -I "$JAR" -A assets -F out/unsigned.apk
(cd out/dex && zip -q ../unsigned.apk classes.dex)
"$BT/zipalign" -f 4 out/unsigned.apk out/aligned.apk
KEY="$HOME/.android/standoff-debug.keystore"
mkdir -p "$HOME/.android"
if [ ! -f "$KEY" ]; then
 keytool -genkeypair -keystore "$KEY" -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Standoff Development' >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KEY" --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey --out out/Standoff3-6.0.apk out/aligned.apk
"$BT/apksigner" verify out/Standoff3-6.0.apk
