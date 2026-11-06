#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/base/smartpointer.h"
#include <filesystem>
#include <functional>
#include <string>

namespace aurel {

/** Restore component.bin / controller.bin from a slot's state folder. */
void restorePluginState(Steinberg::Vst::IComponent& component, Steinberg::Vst::IEditController* controller,
                        const std::filesystem::path& directory);

/** Write component.bin / controller.bin into a slot's state folder. */
void savePluginState(Steinberg::Vst::IComponent& component, Steinberg::Vst::IEditController* controller,
                     const std::filesystem::path& directory);

/**
 * A plug-in editor in its own top-level window. It does not block: the host's
 * message loop drives it, so audio keeps running while it is open.
 */
class EditorWindow {
public:
    EditorWindow(Steinberg::Vst::IEditController& controller, std::wstring title, HWND owner,
                 std::function<void()> onClosed);
    ~EditorWindow();
    void focus();
    void close();
    bool isOpen() const { return hwnd != nullptr; }

private:
    struct Frame;
    static LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam);
    Steinberg::IPtr<Steinberg::IPlugView> view;
    Steinberg::IPtr<Frame> frame;
    HWND hwnd = nullptr;
    bool attached = false;
    std::function<void()> onClosed;
};

} // namespace aurel
