#!/usr/bin/env python3
"""Package dist/www into a signed Android APK, using only the SDK command-line tools.

    python -I tools/build_apk.py            (needs JDK 17+ and an Android SDK with build-tools)

Output
    dist/轨迹攻略.apk

The signing key is created on the first run and kept in signing/: with the same key the next
build installs over the previous one; with another key Android refuses to update.
"""
import datetime
import os
import secrets
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANDROID = ROOT / "src" / "android"
WORK = ROOT / "build" / "apk"
SIGNING = ROOT / "signing"
KEYSTORE = SIGNING / "release.jks"
KEY_ALIAS = "trails-guide"
PLATFORM = "android-35"
MIN_SDK, TARGET_SDK = 26, 34
APP_ID = "app.trailsguide"


def sdk_dir():
    for name in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        if os.environ.get(name):
            return Path(os.environ[name])
    return Path(os.environ.get("LOCALAPPDATA", "")) / "Android" / "Sdk"


def newest_with(folder, binary):
    candidates = [d for d in sorted(folder.iterdir()) if (d / binary).exists()]
    if not candidates:
        sys.exit(f"no {binary} under {folder}")
    return candidates[-1]


def run(title, *command, env=None):
    print(f"$ {title}")
    result = subprocess.run([str(c) for c in command], capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    if result.returncode:
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        sys.exit(f"failed ({result.returncode}): {title}")
    return result.stdout.strip()


def signing_password():
    """The keystore password, generating keystore + password file on first use."""
    props = SIGNING / "signing.properties"
    if not KEYSTORE.exists():
        SIGNING.mkdir(parents=True, exist_ok=True)
        password = secrets.token_urlsafe(18)
        run("keytool -genkeypair", JAVA_HOME / "bin" / "keytool.exe", "-genkeypair", "-keystore", KEYSTORE,
            "-alias", KEY_ALIAS, "-keyalg", "RSA", "-keysize", "2048", "-validity", "10950",
            "-storepass", password, "-keypass", password, "-dname", "CN=Trails Guide, O=Personal use")
        props.write_text(f"# Password of release.jks (alias {KEY_ALIAS}). Keep both files to ship updates.\nstorePassword={password}\n",
                         encoding="utf-8")
        print(f"created {KEYSTORE.relative_to(ROOT)} and {props.relative_to(ROOT)}")
    for line in props.read_text(encoding="utf-8").splitlines():
        if line.startswith("storePassword="):
            return line.split("=", 1)[1]
    sys.exit(f"no storePassword in {props}")


def main():
    global JAVA_HOME
    sys.stdout.reconfigure(encoding="utf-8")
    JAVA_HOME = Path(os.environ.get("JAVA_HOME") or "")
    if not (JAVA_HOME / "bin" / "javac.exe").exists():
        sys.exit("JAVA_HOME must point at a JDK")
    sdk = sdk_dir()
    build_tools = newest_with(sdk / "build-tools", "aapt2.exe")
    android_jar = sdk / "platforms" / PLATFORM / "android.jar"
    www = ROOT / "dist" / "www"
    if not (www / "index.html").exists():
        sys.exit("dist/www is missing: run tools/build.py first")

    today = datetime.date.today()
    version_code = int(today.strftime("%Y%m%d")) * 100
    version_name = today.isoformat()
    if WORK.exists():
        shutil.rmtree(WORK)
    shutil.copytree(www, WORK / "assets" / "www")
    (WORK / "classes").mkdir()
    (WORK / "dex").mkdir()

    aapt2 = build_tools / "aapt2.exe"
    run("aapt2 compile", aapt2, "compile", "--dir", ANDROID / "res", "-o", WORK / "res.zip")
    run("aapt2 link", aapt2, "link", "-o", WORK / "base.apk", "-I", android_jar,
        "--manifest", ANDROID / "AndroidManifest.xml", "--java", WORK / "gen",
        "--min-sdk-version", MIN_SDK, "--target-sdk-version", TARGET_SDK,
        "--version-code", version_code, "--version-name", version_name,
        "-A", WORK / "assets", WORK / "res.zip")

    sources = sorted((ANDROID / "java").rglob("*.java")) + sorted((WORK / "gen").rglob("*.java"))
    run("javac", JAVA_HOME / "bin" / "javac.exe", "-J-Duser.language=en", "-encoding", "UTF-8", "--release", "8",
        "-classpath", android_jar, "-nowarn", "-d", WORK / "classes", *sources)
    classes = sorted((WORK / "classes").rglob("*.class"))
    run("d8", JAVA_HOME / "bin" / "java.exe", "-cp", build_tools / "lib" / "d8.jar", "com.android.tools.r8.D8",
        "--release", "--lib", android_jar, "--min-api", MIN_SDK, "--output", WORK / "dex", *classes)
    with zipfile.ZipFile(WORK / "base.apk", "a", zipfile.ZIP_DEFLATED) as apk:
        apk.write(WORK / "dex" / "classes.dex", "classes.dex")

    run("zipalign", build_tools / "zipalign.exe", "-f", "-p", "4", WORK / "base.apk", WORK / "aligned.apk")

    env = dict(os.environ, TRAILS_KS_PASS=signing_password())
    DIST = ROOT / "dist" / "轨迹攻略.apk"
    run("apksigner sign", JAVA_HOME / "bin" / "java.exe", "-jar", build_tools / "lib" / "apksigner.jar", "sign",
        "--ks", KEYSTORE, "--ks-key-alias", KEY_ALIAS, "--ks-pass", "env:TRAILS_KS_PASS", "--key-pass", "env:TRAILS_KS_PASS",
        "--v4-signing-enabled", "false",  # v4 only adds a sidecar .idsig for incremental installs
        "--out", DIST, WORK / "aligned.apk", env=env)

    verify = run("apksigner verify", JAVA_HOME / "bin" / "java.exe", "-jar", build_tools / "lib" / "apksigner.jar",
                 "verify", "--verbose", DIST)
    badging = run("aapt2 dump badging", aapt2, "dump", "badging", DIST)
    print()
    print("\n".join(line for line in verify.splitlines() if line.startswith(("Verifies", "Verified using"))))
    print("\n".join(line for line in badging.splitlines()
                    if line.startswith(("package:", "minSdkVersion", "targetSdkVersion", "application-label:", "uses-permission", "launchable-activity", "native-code"))))
    print(f"\n{DIST.relative_to(ROOT)}  {DIST.stat().st_size / 1024 / 1024:.2f} MB  (version {version_name}, code {version_code})")


if __name__ == "__main__":
    main()
