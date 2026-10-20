$ErrorActionPreference = "Stop"

# 优日 APK 构建脚本：使用项目内 Env，若不存在则复用同级「同学录/Env」工具链。
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$envCandidates = @(
  (Join-Path $projectRoot "Env"),
  (Join-Path $projectRoot "..\同学录\Env")
)
$envRoot = $envCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $envRoot) {
  throw "找不到构建环境 Env（JDK / Android SDK / Gradle）。请把 Env 放在项目根目录，或放在同级「同学录」项目下。"
}
$envRoot = (Resolve-Path $envRoot).Path
$androidHome = Join-Path $envRoot "android-sdk"

$env:JAVA_HOME = Join-Path $envRoot "jdk-21"
$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome
$env:GRADLE_USER_HOME = Join-Path $envRoot "gradle"
$env:npm_config_cache = Join-Path $envRoot "npm-cache"
$env:PATH = "$(Join-Path $env:JAVA_HOME 'bin');$(Join-Path $androidHome 'platform-tools');$env:PATH"

if (-not (Test-Path "node_modules")) {
  npm install --no-audit --no-fund
}

npx cap sync android

Push-Location "android"
try {
  .\gradlew.bat --no-daemon assembleDebug
} finally {
  Pop-Location
}

$apk = Join-Path $PSScriptRoot "android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apk)) {
  throw "APK 构建失败：找不到 $apk"
}

$packageJson = Get-Content (Join-Path $PSScriptRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $packageJson.version
$target = Join-Path $projectRoot "手机端\优日-$version.apk"
Copy-Item -LiteralPath $apk -Destination $target -Force
Write-Host "APK 已生成：$target"
