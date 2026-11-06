#include "editor.h"

#include "pluginterfaces/base/funknownimpl.h"
#include "public.sdk/source/common/memorystream.h"
#include <fstream>
#include <stdexcept>
#include <vector>

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace aurel {
namespace {
constexpr int64 maxState = 64 * 1024 * 1024;

template <typename Restore>
void loadState(const std::filesystem::path& path, Restore restore) {
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    if (!input) return;
    const auto size = static_cast<int64>(input.tellg());
    if (size <= 0 || size > maxState) return;
    std::vector<char> bytes(static_cast<size_t>(size));
    input.seekg(0);
    input.read(bytes.data(), size);
    if (!input) return;
    auto stream = owned(new MemoryStream(bytes.data(), static_cast<TSize>(bytes.size())));
    restore(stream);
}

template <typename Interface>
void saveState(Interface& plugin, const std::filesystem::path& path) {
    auto stream = owned(new MemoryStream);
    if (plugin.getState(stream) != kResultOk || stream->getSize() <= 0) {
        std::error_code ignored;
        std::filesystem::remove(path, ignored);
        return;
    }
    if (stream->getSize() > maxState) throw std::runtime_error("The plug-in returned a state larger than Aurel can save.");
    const auto temp = std::filesystem::path(path).concat(L".tmp");
    {
        std::ofstream output(temp, std::ios::binary | std::ios::trunc);
        output.write(stream->getData(), stream->getSize());
        if (!output) throw std::runtime_error("Could not save the plug-in state.");
    }
    std::filesystem::rename(temp, path);
}

constexpr auto windowClass = L"AurelVstEditor";

void registerClass() {
    static bool done = false;
    if (done) return;
    WNDCLASSW cls{};
    cls.hInstance = GetModuleHandleW(nullptr);
    cls.lpfnWndProc = DefWindowProcW; // replaced per window below
    cls.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
    cls.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    cls.lpszClassName = windowClass;
    RegisterClassW(&cls);
    done = true;
}
} // namespace

void restorePluginState(IComponent& component, IEditController* controller, const std::filesystem::path& directory) {
    loadState(directory / "component.bin", [&](IBStream* state) {
        component.setState(state);
        if (controller) {
            state->seek(0, IBStream::kIBSeekSet, nullptr);
            controller->setComponentState(state);
        }
    });
    if (controller) loadState(directory / "controller.bin", [&](IBStream* state) { controller->setState(state); });
}

void savePluginState(IComponent& component, IEditController* controller, const std::filesystem::path& directory) {
    saveState(component, directory / "component.bin");
    if (controller) saveState(*controller, directory / "controller.bin");
}

/** IPlugFrame: lets the plug-in resize its window. */
struct EditorWindow::Frame final : public U::Implements<U::Directly<IPlugFrame>> {
    HWND* hwnd = nullptr;
    IPlugView* view = nullptr;
    bool resizing = false;
    tresult PLUGIN_API resizeView(IPlugView* sender, ViewRect* size) override {
        if (!hwnd || !*hwnd || !size || sender != view || size->getWidth() <= 0 || size->getHeight() <= 0) return kInvalidArgument;
        if (resizing) return kResultOk;
        resizing = true;
        RECT rect{0, 0, size->getWidth(), size->getHeight()};
        AdjustWindowRect(&rect, static_cast<DWORD>(GetWindowLongPtrW(*hwnd, GWL_STYLE)), FALSE);
        SetWindowPos(*hwnd, nullptr, 0, 0, rect.right - rect.left, rect.bottom - rect.top, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
        const auto result = view->onSize(size);
        resizing = false;
        return result;
    }
};

EditorWindow::EditorWindow(IEditController& controller, std::wstring title, HWND owner, std::function<void()> closed)
    : onClosed(std::move(closed)) {
    registerClass();
    view = owned(controller.createView(ViewType::kEditor));
    if (!view) throw std::runtime_error("This plug-in has no editor window.");
    if (view->isPlatformTypeSupported(kPlatformTypeHWND) != kResultOk)
        throw std::runtime_error("This plug-in does not expose a native Windows editor.");
    ViewRect rect{};
    if (view->getSize(&rect) != kResultOk || rect.getWidth() <= 0 || rect.getHeight() <= 0) rect = {0, 0, 960, 640};
    const DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
    RECT windowRect{0, 0, rect.getWidth(), rect.getHeight()};
    AdjustWindowRect(&windowRect, style, FALSE);
    hwnd = CreateWindowExW(0, windowClass, title.c_str(), style, CW_USEDEFAULT, CW_USEDEFAULT,
                           windowRect.right - windowRect.left, windowRect.bottom - windowRect.top,
                           IsWindow(owner) ? owner : nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
    if (!hwnd) throw std::runtime_error("Could not open the plug-in window.");
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));
    SetWindowLongPtrW(hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(windowProc));
    frame = owned(new Frame);
    frame->hwnd = &hwnd;
    frame->view = view;
    view->setFrame(frame);
    if (view->attached(hwnd, kPlatformTypeHWND) != kResultOk) {
        view->setFrame(nullptr);
        DestroyWindow(hwnd);
        hwnd = nullptr;
        throw std::runtime_error("The plug-in editor could not attach to its window.");
    }
    attached = true;
    ViewRect attachedSize{};
    if (view->getSize(&attachedSize) == kResultOk && attachedSize.getWidth() > 0 && attachedSize.getHeight() > 0)
        frame->resizeView(view, &attachedSize);
    ShowWindow(hwnd, SW_SHOW);
    if (!IsWindowVisible(hwnd)) ShowWindow(hwnd, SW_SHOW);
    focus();
}

EditorWindow::~EditorWindow() {
    onClosed = nullptr;
    close();
}

void EditorWindow::focus() {
    if (!hwnd) return;
    if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
    // A background process may not take focus on its own; borrow the foreground thread's input queue briefly.
    const HWND foreground = GetForegroundWindow();
    const DWORD foregroundThread = foreground ? GetWindowThreadProcessId(foreground, nullptr) : 0;
    const DWORD self = GetCurrentThreadId();
    if (foregroundThread && foregroundThread != self) AttachThreadInput(self, foregroundThread, TRUE);
    BringWindowToTop(hwnd);
    SetForegroundWindow(hwnd);
    if (foregroundThread && foregroundThread != self) AttachThreadInput(self, foregroundThread, FALSE);
}

void EditorWindow::close() {
    if (!hwnd) return;
    if (attached) view->removed();
    attached = false;
    view->setFrame(nullptr);
    const auto window = hwnd;
    hwnd = nullptr;
    DestroyWindow(window);
    if (onClosed) {
        auto callback = std::move(onClosed);
        onClosed = nullptr;
        callback();
    }
}

LRESULT CALLBACK EditorWindow::windowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    auto* editor = reinterpret_cast<EditorWindow*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (message == WM_CLOSE && editor) {
        editor->close();
        return 0;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

} // namespace aurel
