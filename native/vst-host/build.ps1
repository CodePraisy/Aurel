param([string]$Sdk = (Join-Path $env:TEMP 'aurel-vst3sdk-3.8.1'))

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '../..')
$build = Join-Path $env:TEMP 'aurel-vst-host-build'
$out = Join-Path $repo 'build/vst-host'
$sdkVersion = 'v3.8.1_build_84'
$cmake = (Get-Command cmake -ErrorAction SilentlyContinue).Source
if (!$cmake) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    $vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    $cmake = Join-Path $vs 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'
}
if (!(Test-Path -LiteralPath $cmake)) { throw 'CMake and Visual Studio 2022 with the Windows C++ workload are required.' }

if (!(Test-Path -LiteralPath (Join-Path $Sdk 'CMakeLists.txt'))) {
    & git clone --depth 1 --branch $sdkVersion https://github.com/steinbergmedia/vst3sdk.git $Sdk
    if ($LASTEXITCODE) { throw 'Could not fetch the Steinberg VST3 SDK.' }
}
& git -C $Sdk submodule update --init --depth 1 base cmake pluginterfaces public.sdk
if ($LASTEXITCODE) { throw 'Could not fetch the VST3 SDK dependencies.' }

& $cmake -S $PSScriptRoot -B $build -G 'Visual Studio 17 2022' -A x64 "-DVST3_SDK=$Sdk"
if ($LASTEXITCODE) { throw 'Could not configure the VST3 host.' }
& $cmake --build $build --config Release --target aurel-vst-host --parallel
if ($LASTEXITCODE) { throw 'Could not build the VST3 host.' }
New-Item -Path $out -ItemType Directory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $build 'Release/aurel-vst-host.exe') -Destination $out -Force
Copy-Item -LiteralPath (Join-Path $Sdk 'LICENSE.txt') -Destination (Join-Path $out 'Steinberg-VST3-LICENSE.txt') -Force
