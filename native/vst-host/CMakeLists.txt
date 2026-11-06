cmake_minimum_required(VERSION 3.25)
project(aurel_vst_host LANGUAGES CXX)

set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
set(SMTG_USE_STATIC_CRT ON CACHE BOOL "" FORCE)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
file(TO_CMAKE_PATH "${VST3_SDK}" VST3_SDK)
add_subdirectory("${VST3_SDK}" vst3 EXCLUDE_FROM_ALL)

set(hosting "${VST3_SDK}/public.sdk/source/vst/hosting")
add_executable(aurel-vst-host main.cpp editor.cpp "${hosting}/module_win32.cpp" "${hosting}/plugprovider.cpp"
    "${VST3_SDK}/public.sdk/source/common/memorystream.cpp")
target_compile_features(aurel-vst-host PRIVATE cxx_std_17)
target_compile_options(aurel-vst-host PRIVATE /utf-8)
target_link_libraries(aurel-vst-host PRIVATE sdk_hosting ole32 shell32)
